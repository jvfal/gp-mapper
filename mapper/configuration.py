import logging
import math

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from .boards import body
from .models import GuildModule, MapperModuleSettings
from .roles import guild_permissions
from .branding import branding_info
from .notifications import bot_status
from .discord_bot import BotError
from .channel_permissions import configure_notification_channel, notification_channel

logger = logging.getLogger(__name__)


def module_data(module):
    config = getattr(module, 'mapper_settings', None)
    status = bot_status(config)
    return {
        'code': module.code, 'enabled': module.enabled,
        'settings': {
            'discordChannelId': config.discord_channel_id if config else '',
            'warningMinutes': config.warning_minutes if config else 15,
        },
        'botAvailable': status == 'ready',
        'botStatus': status,
        'discordChannel': {
            'name': config.discord_channel_name if config else '',
            'configured': bool(config and config.discord_channel_configured_at),
        },
    }


def announce_disabled():
    try:
        async_to_sync(get_channel_layer().group_send)('module.mapper', {'type': 'module.disabled'})
    except Exception:
        logger.exception('Could not announce mapper module change')


@never_cache
@require_http_methods(['GET'])
def configuration(request):
    if not guild_permissions(request.user)['canManageSettings']:
        return JsonResponse({'error': 'permission_denied'}, status=403)
    module = GuildModule.objects.select_related('mapper_settings').filter(code='mapper').first()
    return JsonResponse({'modules': [module_data(module or GuildModule(code='mapper'))], 'branding': branding_info()})


@never_cache
@require_http_methods(['PUT', 'PATCH'])
def configure_mapper(request):
    if not guild_permissions(request.user)['canManageSettings']:
        return JsonResponse({'error': 'permission_denied'}, status=403)
    try:
        data = body(request)
        enabled = data.get('enabled')
        config = data.get('settings') if request.method == 'PUT' else None
        if type(enabled) is not bool or (request.method == 'PUT' and not isinstance(config, dict)):
            raise ValueError('invalid_settings')
        if config is not None:
            channel, minutes = config.get('discordChannelId', ''), config.get('warningMinutes', 15)
            if not isinstance(channel, str):
                raise ValueError('invalid_channel')
            channel = channel.strip()
            if channel and (not channel.isascii() or not channel.isdecimal() or len(channel) > 20):
                raise ValueError('invalid_channel')
            if type(minutes) is not int or not 1 <= minutes <= 120:
                raise ValueError('invalid_warning_minutes')
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=400)
    with transaction.atomic():
        module, _ = GuildModule.objects.select_for_update().get_or_create(code='mapper')
        was_enabled = module.enabled
        module.enabled = enabled
        module.save(update_fields=['enabled'])
        if config is not None:
            previous_channel = MapperModuleSettings.objects.filter(module=module).values_list('discord_channel_id', flat=True).first()
            defaults = {'discord_channel_id': channel, 'warning_minutes': minutes}
            if previous_channel != channel:
                defaults.update(bot_checked_at=None, bot_last_error='', bot_retry_at=None,
                                discord_channel_name='', discord_channel_configured_at=None)
            MapperModuleSettings.objects.update_or_create(module=module, defaults=defaults)
        if was_enabled and not enabled:
            transaction.on_commit(announce_disabled)
    return JsonResponse({'module': module_data(module)})


@never_cache
@require_http_methods(['GET', 'POST'])
def prepare_discord_channel(request):
    if not guild_permissions(request.user)['canManageSettings']:
        return JsonResponse({'error': 'permission_denied'}, status=403)
    try:
        data = body(request) if request.method == 'POST' else {}
        if request.method == 'POST' and data.get('confirmed') is not True:
            raise ValueError('confirmation_required')
        if not settings.DISCORD_BOT_TOKEN:
            raise ValueError('missing_token')
        if not all(value and value.isascii() and value.isdecimal() and len(value) <= 20
                   for value in (settings.DISCORD_GUILD_ID, settings.DISCORD_MEMBER_ROLE_ID)):
            raise ValueError('invalid_discord_configuration')
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=400)
    with transaction.atomic():
        module = GuildModule.objects.select_for_update().filter(code='mapper', enabled=True).first()
        if not module:
            return JsonResponse({'error': 'module_disabled'}, status=400)
        config = MapperModuleSettings.objects.select_for_update().filter(module=module).first()
        if not config or not config.discord_channel_id:
            return JsonResponse({'error': 'missing_channel'}, status=400)
        if request.method == 'POST' and data.get('channelId') != config.discord_channel_id:
            return JsonResponse({'error': 'channel_changed'}, status=409)
        try:
            if request.method == 'GET':
                channel_name = notification_channel(config.discord_channel_id)['name']
            else:
                channel_name = configure_notification_channel(config.discord_channel_id)
        except BotError as error:
            logger.warning('Discord channel setup failed: stage=%s http_status=%s discord_code=%s error=%s missing_permissions=%s',
                           error.stage, error.http_status, error.discord_code, error.code, ','.join(error.missing_permissions))
            response = JsonResponse({'error': error.code, 'retryAfter': error.retry_after,
                                     'stage': error.stage, 'discordCode': error.discord_code,
                                     'missingPermissions': error.missing_permissions}, status=429 if error.code == 'rate_limited' else 400)
            if error.code == 'rate_limited':
                response['Retry-After'] = str(math.ceil(error.retry_after))
            return response
        config.discord_channel_name = channel_name
        if request.method == 'POST':
            config.bot_checked_at = None
            config.discord_channel_configured_at = timezone.now()
        config.save(update_fields=['discord_channel_name', 'discord_channel_configured_at', 'bot_checked_at'])
    return JsonResponse({'configured': bool(config.discord_channel_configured_at),
                         'channelName': channel_name, 'channelId': config.discord_channel_id})
