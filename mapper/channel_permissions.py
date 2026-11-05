"""Explicit, one-off setup of a dedicated Discord notification channel."""
from django.conf import settings

from .discord_bot import BotError, discord_request

MANAGE_ROLES = 1 << 28
VIEW_CHANNEL = 1 << 10
SEND_MESSAGES = 1 << 11
EMBED_LINKS = 1 << 14
READ_HISTORY = 1 << 16
CREATE_PUBLIC_THREADS = 1 << 35
CREATE_PRIVATE_THREADS = 1 << 36
SEND_IN_THREADS = 1 << 38
WRITE = SEND_MESSAGES | CREATE_PUBLIC_THREADS | CREATE_PRIVATE_THREADS | SEND_IN_THREADS
READ = VIEW_CHANNEL | READ_HISTORY
CONTROLLED = READ | WRITE
BOT_ACCESS = READ | SEND_MESSAGES | EMBED_LINKS | MANAGE_ROLES


def clean_overwrite(overwrite):
    try:
        result = {'id': str(overwrite['id']), 'type': overwrite['type'],
                  'allow': int(overwrite.get('allow', '0')), 'deny': int(overwrite.get('deny', '0'))}
    except (KeyError, ValueError, TypeError):
        raise BotError('discord_error') from None
    if result['type'] not in (0, 1) or not result['id'].isascii() or not result['id'].isdecimal() or min(result['allow'], result['deny']) < 0:
        raise BotError('discord_error')
    return result


def wire(overwrite):
    return {**overwrite, 'allow': str(overwrite['allow']), 'deny': str(overwrite['deny'])}


def channel_overwrites(existing, guild_id, role_id, bot_id):
    overwrites = {(item['type'], item['id']): item for item in map(clean_overwrite, existing)}
    for target in ((0, guild_id), (0, role_id), (1, bot_id)):
        overwrites.setdefault(target, {'type': target[0], 'id': target[1], 'allow': 0, 'deny': 0})
    for (kind, target), item in overwrites.items():
        if (kind, target) == (1, bot_id):
            item['allow'] |= BOT_ACCESS
            item['deny'] &= ~BOT_ACCESS
        elif (kind, target) == (0, role_id):
            item['allow'] = (item['allow'] & ~CONTROLLED) | READ
            item['deny'] = (item['deny'] & ~CONTROLLED) | WRITE
        elif kind == 0:
            # Other role allows must not let non-members read or send here.
            item['allow'] &= ~CONTROLLED
            item['deny'] |= CONTROLLED
        else:
            # Human-specific overwrites inherit read access from their roles.
            item['allow'] &= ~CONTROLLED
            item['deny'] = (item['deny'] & ~READ) | WRITE
    return [wire(item) for item in overwrites.values()]


def checked_request(*args, **kwargs):
    result, delay = discord_request(*args, **kwargs)
    if delay:
        raise BotError('rate_limited', delay)
    return result


def notification_channel(channel_id):
    channel = checked_request(f'/channels/{channel_id}')
    if not isinstance(channel, dict) or channel.get('guild_id') != settings.DISCORD_GUILD_ID:
        raise BotError('wrong_guild')
    if channel.get('type') not in (0, 5):
        raise BotError('invalid_channel_type')
    if not isinstance(channel.get('name'), str) or not channel['name']:
        raise BotError('discord_error')
    return channel


def configure_notification_channel(channel_id):
    guild_id, role_id = settings.DISCORD_GUILD_ID, settings.DISCORD_MEMBER_ROLE_ID
    channel = notification_channel(channel_id)
    roles = checked_request(f'/guilds/{guild_id}/roles')
    if not isinstance(roles, list) or role_id == guild_id or not any(
        role.get('id') == role_id and not role.get('managed') for role in roles if isinstance(role, dict)
    ):
        raise BotError('member_role_not_found')
    bot = checked_request('/users/@me')
    if not isinstance(bot, dict) or not bot.get('bot') or not isinstance(bot.get('id'), str) or not bot['id'].isascii() or not bot['id'].isdecimal():
        raise BotError('invalid_token')
    overwrites = channel_overwrites(channel.get('permission_overwrites', []), guild_id, role_id, bot['id'])
    bot_overwrite = next(item for item in overwrites if item['type'] == 1 and item['id'] == bot['id'])
    # Grant the bot its explicit channel access first, preventing accidental lockout.
    # A channel MANAGE_ROLES overwrite also permits denying thread permissions
    # without requiring those unnecessary permissions on the bot's server role.
    checked_request(f'/channels/{channel_id}/permissions/{bot["id"]}', bot_overwrite, method='PUT')
    # Apply the channel's complete set in a single update, retaining unrelated bits.
    result, _ = discord_request(f'/channels/{channel_id}', {'permission_overwrites': overwrites}, method='PATCH')
    if not isinstance(result, dict) or result.get('id') != channel_id or result.get('guild_id') != guild_id:
        raise BotError('discord_error')
    return channel['name']
