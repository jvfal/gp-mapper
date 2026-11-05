"""Guild Master management with application permissions, independent of Django admin permissions."""
from django.contrib.auth import get_user_model
from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods
from django.utils import timezone

from .authentication import display_name
from .boards import body
from .models import DiscordAccount, GuildRole
from .roles import guild_permissions, is_guild_master, site_access


def allowed(request):
    return guild_permissions(request.user)['canManageMembers']


def role_data(role):
    return {
        'id': role.pk, 'name': role.name, 'isDefault': role.is_default,
        'canViewGuildMaps': role.can_view_guild_maps,
        'canCreateGuildMaps': role.can_create_guild_maps,
        'canDeleteGuildMaps': role.can_delete_guild_maps,
        'discordRoleId': role.discord_role_id,
    }


def member_profile(user):
    account = getattr(user, 'discord_account', None)
    activity = getattr(user, 'mapper_activity', None)
    return {
        'joinedAt': user.date_joined.isoformat(),
        'lastAccessAt': activity.last_access_at.isoformat() if activity else None,
        'discordUsername': account.username if account else None,
        'discordId': account.discord_id if account else None,
        'avatarUrl': f'https://cdn.discordapp.com/avatars/{account.discord_id}/{account.avatar}.png?size=64' if account and account.avatar else None,
    }


@never_cache
@require_http_methods(['GET'])
def members(request):
    if not allowed(request):
        return JsonResponse({'error': 'permission_denied'}, status=403)
    users = get_user_model().objects.filter(is_superuser=False).select_related('discord_account', 'mapper_activity').prefetch_related('guild_roles', 'discord_guild_roles', 'groups').order_by('username')
    return JsonResponse({
        'roles': [role_data(role) for role in GuildRole.objects.all()],
        'members': [{
            'id': user.pk, 'name': display_name(user), 'isActive': user.is_active,
            **member_profile(user),
            'isGuildMaster': any(group.name == 'Guild Master' for group in user.groups.all()),
            'isProtected': user.is_superuser or any(group.name == 'Guild Master' for group in user.groups.all()),
            'roleIds': sorted({role.pk for role in user.guild_roles.all()} | {role.pk for role in user.discord_guild_roles.all()}),
            'automaticRoleIds': [role.pk for role in user.discord_guild_roles.all()],
            'pendingApproval': bool(getattr(user, 'discord_account', None) and user.is_active and not site_access(user)),
            'manuallyApproved': bool(getattr(user, 'discord_account', None)
                                     and user.discord_account.manually_approved
                                     and user.discord_account.approval_guild_id == settings.DISCORD_GUILD_ID),
        } for user in users],
    })


@never_cache
@require_http_methods(['PUT'])
def member_approval(request, user_id):
    if not allowed(request):
        return JsonResponse({'error': 'permission_denied'}, status=403)
    try:
        approved = body(request).get('approved')
        if type(approved) is not bool:
            raise ValueError('invalid_approval')
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=400)
    with transaction.atomic():
        user = get_object_or_404(get_user_model().objects.select_for_update(), pk=user_id)
        if not user.is_active or is_guild_master(user) or user.is_superuser:
            return JsonResponse({'error': 'protected_member'}, status=400)
        account = get_object_or_404(DiscordAccount.objects.select_for_update(), user=user)
        if not settings.DISCORD_GUILD_ID:
            return JsonResponse({'error': 'guild_not_configured'}, status=400)
        if account.guild_id and account.guild_id != settings.DISCORD_GUILD_ID:
            return JsonResponse({'error': 'invalid_guild'}, status=400)
        if not account.guild_id and approved:
            # Accounts created before guild validation have no guild ID yet.
            # Manual approval binds them locally; it does not verify a Discord role.
            account.guild_id = settings.DISCORD_GUILD_ID
            account.is_member = False
        account.manually_approved = approved
        account.approval_guild_id = settings.DISCORD_GUILD_ID if approved else ''
        account.approved_by = request.user if approved else None
        account.approved_at = timezone.now() if approved else None
        account.save(update_fields=['guild_id', 'is_member', 'manually_approved', 'approval_guild_id', 'approved_by', 'approved_at'])
        if approved and not user.guild_roles.exists():
            role = GuildRole.objects.filter(is_default=True).first()
            if role:
                user.guild_roles.add(role)
    return JsonResponse({'saved': True})


@never_cache
@require_http_methods(['POST', 'PUT', 'DELETE'])
def roles(request, role_id=None):
    if not allowed(request):
        return JsonResponse({'error': 'permission_denied'}, status=403)
    with transaction.atomic():
        role = get_object_or_404(GuildRole.objects.select_for_update(), pk=role_id) if role_id else GuildRole()
        if request.method == 'DELETE':
            if role_id is None or role.is_default:
                return JsonResponse({'error': 'default_role_required'}, status=400)
            # Members keep their other roles; no permissions are silently added.
            role.delete()
            return JsonResponse({'deleted': True})
        try:
            data = body(request)
            name = data.get('name')
            discord_id = data.get('discordRoleId', role.discord_role_id)
            if not isinstance(discord_id, str):
                raise ValueError('invalid_discord_role_id')
            discord_id = discord_id.strip()
            if discord_id and (not discord_id.isascii() or not discord_id.isdecimal() or len(discord_id) > 20):
                raise ValueError('invalid_discord_role_id')
            view, create = data.get('canViewGuildMaps'), data.get('canCreateGuildMaps')
            delete = data.get('canDeleteGuildMaps', role.can_delete_guild_maps)
            if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
                raise ValueError('invalid_name')
            if type(view) is not bool or type(create) is not bool or type(delete) is not bool or (create or delete) and not view:
                raise ValueError('invalid_permissions')
            if name.strip().casefold() == 'guild master':
                raise ValueError('reserved_role')
            if GuildRole.objects.filter(name__iexact=name.strip()).exclude(pk=role.pk).exists():
                raise ValueError('duplicate_role')
        except ValueError as error:
            return JsonResponse({'error': str(error)}, status=400)
        role.name, role.can_view_guild_maps, role.can_create_guild_maps = name.strip(), view, create
        role.can_delete_guild_maps = delete
        old_discord_id = role.discord_role_id
        role.discord_role_id = discord_id
        try:
            role.save()
        except IntegrityError:
            return JsonResponse({'error': 'duplicate_role'}, status=400)
        if old_discord_id != discord_id:
            # An old mapping must not retain automatic access after being changed or removed.
            role.discord_members.clear()
    return JsonResponse({'role': role_data(role)})


@never_cache
@require_http_methods(['PUT'])
def member_roles(request, user_id):
    if not allowed(request):
        return JsonResponse({'error': 'permission_denied'}, status=403)
    with transaction.atomic():
        user = get_object_or_404(get_user_model().objects.select_for_update(), pk=user_id)
        if is_guild_master(user) or user.is_superuser:
            return JsonResponse({'error': 'protected_member'}, status=400)
        try:
            ids = body(request).get('roleIds')
            if not isinstance(ids, list) or any(type(pk) is not int for pk in ids) or len(set(ids)) != len(ids):
                raise ValueError('invalid_roles')
            chosen = list(GuildRole.objects.select_for_update().filter(pk__in=ids))
            if len(chosen) != len(ids):
                raise ValueError('invalid_roles')
        except ValueError as error:
            return JsonResponse({'error': str(error)}, status=400)
        automatic_ids = set(user.discord_guild_roles.values_list('pk', flat=True))
        manual_ids = set(user.guild_roles.values_list('pk', flat=True))
        user.guild_roles.set([role for role in chosen if role.pk not in automatic_ids or role.pk in manual_ids])
    return JsonResponse({'saved': True})
