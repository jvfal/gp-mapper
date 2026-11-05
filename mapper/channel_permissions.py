"""Explicit, one-off setup of a dedicated Discord notification channel."""
from django.conf import settings

from .discord_bot import BotError, discord_request

MANAGE_ROLES = 1 << 28
MANAGE_CHANNELS = 1 << 4
ADMINISTRATOR = 1 << 3
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
BOT_ACCESS = READ | SEND_MESSAGES | EMBED_LINKS
REQUIRED_PERMISSIONS = {
    'MANAGE_ROLES': MANAGE_ROLES, 'MANAGE_CHANNELS': MANAGE_CHANNELS,
    'VIEW_CHANNEL': VIEW_CHANNEL, 'SEND_MESSAGES': SEND_MESSAGES,
    'EMBED_LINKS': EMBED_LINKS, 'READ_MESSAGE_HISTORY': READ_HISTORY,
}
THREAD_PERMISSIONS = {
    'CREATE_PUBLIC_THREADS': CREATE_PUBLIC_THREADS,
    'CREATE_PRIVATE_THREADS': CREATE_PRIVATE_THREADS,
    'SEND_MESSAGES_IN_THREADS': SEND_IN_THREADS,
}


def check_bot_permissions(channel, roles, member, bot_id):
    role_ids = {settings.DISCORD_GUILD_ID, *member.get('roles', [])}
    base = 0
    for role in roles:
        if role.get('id') in role_ids:
            base |= int(role.get('permissions', '0'))
    if base & ADMINISTRATOR:
        return
    overwrites = [clean_overwrite(item) for item in channel.get('permission_overwrites', [])]
    effective = effective_permissions(channel.get('permission_overwrites', []), base, role_ids, bot_id)
    missing = [name for name, bit in REQUIRED_PERMISSIONS.items() if not effective & bit]
    if missing:
        code = 'bot_permissions_not_installed' if any(not base & REQUIRED_PERMISSIONS[name] for name in missing) else 'channel_permissions_blocked'
        raise BotError(code, stage='check_bot_permissions', missing_permissions=missing)
    # Without an existing channel Manage Permissions grant, Discord only lets
    # bots allow/deny permissions they already have on the server/parent.
    channel_manage = any(
        item['allow'] & MANAGE_ROLES and (
            item['type'] == 0 and item['id'] in role_ids or item['type'] == 1 and item['id'] == bot_id
        ) for item in overwrites
    )
    if not channel_manage:
        available = base
        if any(not base & bit for bit in THREAD_PERMISSIONS.values()) and channel.get('parent_id'):
            parent = notification_channel(channel['parent_id'], category=True)
            available |= effective_permissions(parent.get('permission_overwrites', []), base, role_ids, bot_id)
        missing = [name for name, bit in THREAD_PERMISSIONS.items() if not available & bit]
        if missing:
            raise BotError('bot_thread_permissions_required', stage='check_bot_permissions', missing_permissions=missing)


def effective_permissions(existing, base, role_ids, bot_id):
    """Apply Discord's everyone -> roles -> member precedence."""
    overwrites = [clean_overwrite(item) for item in existing]
    effective = base
    for item in overwrites:
        if item['type'] == 0 and item['id'] == settings.DISCORD_GUILD_ID:
            effective = (effective & ~item['deny']) | item['allow']
    allow = deny = 0
    for item in overwrites:
        if item['type'] == 0 and item['id'] in role_ids and item['id'] != settings.DISCORD_GUILD_ID:
            allow |= item['allow']
            deny |= item['deny']
    effective = (effective & ~deny) | allow
    for item in overwrites:
        if item['type'] == 1 and item['id'] == bot_id:
            effective = (effective & ~item['deny']) | item['allow']
    return effective


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


def checked_request(*args, stage=None, **kwargs):
    try:
        result, delay = discord_request(*args, **kwargs)
    except BotError as error:
        error.stage = stage
        raise
    if delay:
        raise BotError('rate_limited', delay, stage=stage)
    return result


def notification_channel(channel_id, *, category=False):
    channel = checked_request(f'/channels/{channel_id}', stage='read_channel')
    if not isinstance(channel, dict) or channel.get('guild_id') != settings.DISCORD_GUILD_ID:
        raise BotError('wrong_guild')
    if channel.get('type') not in ((4,) if category else (0, 5)):
        raise BotError('invalid_channel_type')
    if not isinstance(channel.get('name'), str) or not channel['name']:
        raise BotError('discord_error')
    return channel


def configure_notification_channel(channel_id):
    guild_id, role_id = settings.DISCORD_GUILD_ID, settings.DISCORD_MEMBER_ROLE_ID
    channel = notification_channel(channel_id)
    roles = checked_request(f'/guilds/{guild_id}/roles', stage='read_roles')
    if not isinstance(roles, list) or role_id == guild_id or not any(
        role.get('id') == role_id and not role.get('managed') for role in roles if isinstance(role, dict)
    ):
        raise BotError('member_role_not_found')
    bot = checked_request('/users/@me', stage='identify_bot')
    if not isinstance(bot, dict) or not bot.get('bot') or not isinstance(bot.get('id'), str) or not bot['id'].isascii() or not bot['id'].isdecimal():
        raise BotError('invalid_token')
    member = checked_request(f'/guilds/{guild_id}/members/{bot["id"]}', stage='read_bot_membership')
    if not isinstance(member, dict) or not isinstance(member.get('roles'), list):
        raise BotError('discord_error', stage='read_bot_membership')
    check_bot_permissions(channel, roles, member, bot['id'])
    overwrites = channel_overwrites(channel.get('permission_overwrites', []), guild_id, role_id, bot['id'])
    bot_overwrite = next(item for item in overwrites if item['type'] == 1 and item['id'] == bot['id'])
    # Preserve read/send access before restricting everyone else. Do not grant
    # MANAGE_ROLES here: Discord forbids bootstrapping that channel permission.
    checked_request(f'/channels/{channel_id}/permissions/{bot["id"]}', bot_overwrite, method='PUT', stage='grant_bot_access')
    # Apply the channel's complete set in a single update, retaining unrelated bits.
    try:
        result, _ = discord_request(f'/channels/{channel_id}', {'permission_overwrites': overwrites}, method='PATCH')
    except BotError as error:
        error.stage = 'apply_channel_overwrites'
        raise
    if not isinstance(result, dict) or result.get('id') != channel_id or result.get('guild_id') != guild_id:
        raise BotError('discord_error')
    return channel['name']
