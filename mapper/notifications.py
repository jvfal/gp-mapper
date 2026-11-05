"""Poll current timers. PostgreSQL serializes workers and keeps delivery history."""
import hashlib
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Case, CharField, Exists, OuterRef, Value, When
from django.utils import timezone

from .discord_bot import BotError, discord_request, validate_channel
from .models import Board, BoardConnection, GuildModule, MapperModuleSettings, RouteNotification

logger = logging.getLogger(__name__)
GRACE = timedelta(minutes=5)


def bot_status(config):
    if not settings.DISCORD_BOT_TOKEN:
        return 'missing_token'
    if not settings.DISCORD_GUILD_ID:
        return 'missing_guild'
    if not config or not config.discord_channel_id:
        return 'missing_channel'
    if not config.module.enabled:
        return 'disabled'
    now = timezone.now()
    if not config.bot_last_seen or config.bot_last_seen < now - timedelta(seconds=90):
        return 'worker_offline'
    if config.bot_last_error:
        return config.bot_last_error
    if not config.bot_checked_at or config.bot_checked_at < now - timedelta(minutes=2):
        return 'checking'
    return 'ready'


def message_payload(connection, kind):
    # Discord timestamps localize to the recipient's language/timezone.
    expiry = int(connection.expires_at.timestamp())
    title = 'Rota encerrada' if kind == 'expired' else 'Rota prestes a fechar'
    description = f'{connection.source.road_map.name} ↔ {connection.target.road_map.name}'
    key = f'{connection.board_id}:{connection.client_id}:{connection.expires_at.isoformat()}:{kind}'
    return {
        'embeds': [{
            'title': title,
            'description': description,
            'color': 0xDD6565 if kind == 'expired' else 0xE5B85C,
            'fields': [
                {'name': 'Mapa da guild', 'value': connection.board.name, 'inline': False},
                {'name': 'Encerramento', 'value': f'<t:{expiry}:R> · <t:{expiry}:t>', 'inline': False},
            ],
            'footer': {'text': settings.GUILD_NAME[:100]},
        }],
        'allowed_mentions': {'parse': []},
        'nonce': hashlib.sha256(key.encode()).hexdigest()[:24],
        'enforce_nonce': True,
    }


def record_error(config, error):
    config.bot_last_error = error.code
    config.bot_retry_at = timezone.now() + timedelta(seconds=error.retry_after)
    config.save(update_fields=['bot_last_error', 'bot_retry_at'])
    logger.warning('Discord route notifications: %s', error.code)


def deliver(board_id, client_id, expiry):
    with transaction.atomic():
        # Same order as module settings writes, then board edits. Recheck after locking.
        module = GuildModule.objects.select_for_update().filter(code='mapper', enabled=True).first()
        if not module:
            return False
        config = MapperModuleSettings.objects.select_for_update().get(module=module)
        now = timezone.now()
        MapperModuleSettings.objects.filter(pk=config.pk).update(bot_last_seen=now)
        if not config.discord_channel_id or config.bot_retry_at and config.bot_retry_at > now:
            return False
        board = Board.objects.select_for_update().filter(pk=board_id, scope='guild', guild_can_view=True).first()
        if not board:
            return True
        connection = BoardConnection.objects.select_related('board', 'source__road_map', 'target__road_map').filter(
            board=board, client_id=client_id, expires_at=expiry,
            expires_at__gte=now - GRACE,
            expires_at__lte=now + timedelta(minutes=config.warning_minutes),
        ).first()
        if not connection:
            return True
        kind = 'expired' if connection.expires_at <= now else 'warning'
        notification, _ = RouteNotification.objects.get_or_create(
            board=board, connection_id=client_id, expires_at=expiry, kind=kind,
        )
        if notification.sent_at:
            return True
        notification.attempts += 1
        try:
            # Check the current destination under the settings lock, including channel changes.
            delay = validate_channel(config.discord_channel_id)
            if delay:
                raise BotError('rate_limited', delay)
            result, delay = discord_request(f'/channels/{config.discord_channel_id}/messages', message_payload(connection, kind))
            if not isinstance(result, dict) or not result.get('id'):
                raise BotError('discord_error')
        except BotError as error:
            notification.last_error = error.code
            notification.save(update_fields=['attempts', 'last_error'])
            record_error(config, error)
            return False
        notification.sent_at = timezone.now()
        notification.last_error = ''
        notification.save(update_fields=['sent_at', 'attempts', 'last_error'])
        config.bot_last_error = ''
        config.bot_checked_at = timezone.now()
        config.bot_retry_at = timezone.now() + timedelta(seconds=delay) if delay else None
        config.save(update_fields=['bot_last_error', 'bot_checked_at', 'bot_retry_at'])
        return not delay


def check_configuration():
    with transaction.atomic():
        module = GuildModule.objects.select_for_update().filter(code='mapper').first()
        if not module:
            return None
        config = MapperModuleSettings.objects.select_for_update().filter(module=module).first()
        if not config:
            return None
        now = timezone.now()
        config.bot_last_seen = now
        config.save(update_fields=['bot_last_seen'])
        if not module.enabled or not settings.DISCORD_BOT_TOKEN or not settings.DISCORD_GUILD_ID or not config.discord_channel_id:
            return None
        if config.bot_retry_at and config.bot_retry_at > now:
            return None
        # Validates token/channel even when no timers currently need an alert.
        try:
            delay = validate_channel(config.discord_channel_id)
        except BotError as error:
            record_error(config, error)
            return None
        config.bot_checked_at = timezone.now()
        config.bot_last_error = ''
        config.bot_retry_at = timezone.now() + timedelta(seconds=delay) if delay else None
        config.save(update_fields=['bot_checked_at', 'bot_last_error', 'bot_retry_at'])
        return None if delay else config


def run_tick():
    config = check_configuration()
    if not config:
        return
    now = timezone.now()
    kind = Case(When(expires_at__lte=now, then=Value('expired')), default=Value('warning'), output_field=CharField())
    sent = RouteNotification.objects.filter(
        board_id=OuterRef('board_id'), connection_id=OuterRef('client_id'),
        expires_at=OuterRef('expires_at'), kind=OuterRef('notification_kind'), sent_at__isnull=False,
    )
    connections = BoardConnection.objects.filter(
        board__scope='guild', board__guild_can_view=True,
        expires_at__gte=now - GRACE, expires_at__lte=now + timedelta(minutes=config.warning_minutes),
    ).annotate(notification_kind=kind).filter(~Exists(sent)).order_by('expires_at').values_list('board_id', 'client_id', 'expires_at')[:100]
    for board_id, client_id, expiry in list(connections):
        if not deliver(board_id, client_id, expiry):
            break
