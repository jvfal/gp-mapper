import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from .boards import body
from .models import GuildModule, MapperModuleSettings
from .roles import guild_permissions
from .branding import branding_info
from .notifications import bot_status

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
                defaults.update(bot_checked_at=None, bot_last_error='', bot_retry_at=None)
            MapperModuleSettings.objects.update_or_create(module=module, defaults=defaults)
        if was_enabled and not enabled:
            transaction.on_commit(announce_disabled)
    return JsonResponse({'module': module_data(module)})
