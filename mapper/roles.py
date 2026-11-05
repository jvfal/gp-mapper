"""Local roles. Discord synchronization must never assign Guild Master."""

GUILD_MASTER_GROUP = 'Guild Master'


def membership_required():
    from django.conf import settings
    return bool(settings.DISCORD_GUILD_ID or settings.DISCORD_MEMBER_ROLE_ID)


def is_guild_master(user):
    if not user.is_authenticated or not user.is_active:
        return False
    # The user is reloaded for each HTTP request and WebSocket operation.
    if not hasattr(user, '_mapper_guild_master'):
        user._mapper_guild_master = user.groups.filter(name=GUILD_MASTER_GROUP).exists()
    return user._mapper_guild_master


def site_access(user):
    from django.conf import settings
    if not user.is_authenticated or not user.is_active:
        return False
    if user.is_superuser or is_guild_master(user) or not membership_required():
        return True
    account = getattr(user, 'discord_account', None)
    return bool(settings.DISCORD_GUILD_ID and settings.DISCORD_MEMBER_ROLE_ID and account
                and account.guild_id == settings.DISCORD_GUILD_ID and (
                    account.is_member or (account.manually_approved and account.approval_guild_id == settings.DISCORD_GUILD_ID)
                ))


def guild_permissions(user):
    if not site_access(user):
        return {'canViewGuildMaps': False, 'canCreateGuildMaps': False, 'canManageMembers': False, 'canManageSettings': False}
    if is_guild_master(user) or user.is_superuser:
        return {'canViewGuildMaps': True, 'canCreateGuildMaps': True, 'canManageMembers': True, 'canManageSettings': True}
    if not hasattr(user, '_mapper_guild_permissions'):
        roles = [*user.guild_roles.all(), *user.discord_guild_roles.all()]
        user._mapper_guild_permissions = {
            'canViewGuildMaps': any(role.can_view_guild_maps for role in roles),
            'canCreateGuildMaps': any(role.can_create_guild_maps for role in roles),
            'canManageMembers': False,
            'canManageSettings': False,
        }
    return user._mapper_guild_permissions
