"""Discord authorization-code login using the existing Django session."""
import json
import re
import secrets
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.db import IntegrityError, transaction
from django.shortcuts import redirect
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.debug import sensitive_variables

from .models import DiscordAccount, GuildRole
from .roles import guild_permissions, is_guild_master, membership_required, site_access
from .modules import module_states
from .branding import branding_info

SESSION_KEY = 'discord_oauth_attempts'


def discord_enabled():
    configured = not membership_required() or all(
        re.fullmatch(r'[0-9]{1,20}', value)
        for value in (settings.DISCORD_GUILD_ID, settings.DISCORD_MEMBER_ROLE_ID)
    )
    return bool(configured and settings.DISCORD_CLIENT_ID and settings.DISCORD_CLIENT_SECRET and settings.DISCORD_REDIRECT_URI)


def display_name(user):
    account = getattr(user, 'discord_account', None)
    return account.display_name if account else user.get_username()


def session_info(request):
    user = request.user
    info = None
    if user.is_authenticated:
        account = getattr(user, 'discord_account', None)
        avatar = None
        if account and account.avatar:
            avatar = f'https://cdn.discordapp.com/avatars/{account.discord_id}/{account.avatar}.png?size=64'
        info = {
            'id': user.pk, 'name': display_name(user), 'isStaff': user.is_staff,
            'isGuildMaster': is_guild_master(user), 'avatarUrl': avatar,
            'canAccess': site_access(user), 'permissions': guild_permissions(user),
            'approvalPending': bool(account and user.is_active and not site_access(user)),
        }
    return {'user': info, 'auth': {'discordEnabled': discord_enabled()}, 'modules': module_states(), 'branding': branding_info()}


@never_cache
@require_GET
def current_session(request):
    from django.http import JsonResponse
    return JsonResponse(session_info(request))


def safe_next(request, value):
    if value and len(value) <= 2048 and url_has_allowed_host_and_scheme(
        value, allowed_hosts={request.get_host()}, require_https=urlsplit(settings.DISCORD_REDIRECT_URI).scheme == 'https'
    ):
        return value
    return '/'


def auth_error(reason):
    return redirect('/?' + urlencode({'auth_error': reason}))


@never_cache
@require_GET
def discord_start(request):
    if request.user.is_authenticated and site_access(request.user):
        return redirect(safe_next(request, request.GET.get('next')))
    if not discord_enabled():
        return auth_error('unavailable')
    now = int(time.time())
    attempts = {key: value for key, value in request.session.get(SESSION_KEY, {}).items()
                if now - value['created'] < 600}
    # Bound session storage while supporting login from a few browser tabs.
    if len(attempts) >= 5:
        attempts.pop(next(iter(attempts)))
    state = secrets.token_urlsafe(32)
    attempts[state] = {'created': now, 'next': safe_next(request, request.GET.get('next'))}
    request.session[SESSION_KEY] = attempts
    return redirect('https://discord.com/oauth2/authorize?' + urlencode({
        'client_id': settings.DISCORD_CLIENT_ID, 'redirect_uri': settings.DISCORD_REDIRECT_URI,
        'response_type': 'code',
        'scope': 'identify email guilds.members.read' if membership_required() else 'identify email',
        'state': state,
    }))


def discord_json(request):
    with urlopen(request, timeout=10) as response:
        raw = response.read(65537)
    if len(raw) > 65536:
        raise ValueError('oversized_discord_response')
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError('invalid_discord_response')
    return data


@sensitive_variables('code', 'token', 'access_token')
def discord_profile(code):
    token = discord_json(Request('https://discord.com/api/oauth2/token', data=urlencode({
        'client_id': settings.DISCORD_CLIENT_ID, 'client_secret': settings.DISCORD_CLIENT_SECRET,
        'grant_type': 'authorization_code', 'code': code, 'redirect_uri': settings.DISCORD_REDIRECT_URI,
    }).encode(), headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AvalonRoadsMapper/1.0'}))
    access_token = token.get('access_token')
    if not isinstance(access_token, str) or not access_token:
        raise ValueError('missing_access_token')
    headers = {
        'Authorization': f'Bearer {access_token}', 'User-Agent': 'AvalonRoadsMapper/1.0',
    }
    profile = discord_json(Request('https://discord.com/api/v10/users/@me', headers=headers))
    if membership_required():
        try:
            member = discord_json(Request(
                f'https://discord.com/api/v10/users/@me/guilds/{settings.DISCORD_GUILD_ID}/member',
                headers=headers,
            ))
        except HTTPError as error:
            if error.code != 404:
                raise
            member = {}
        roles = member.get('roles', [])
        if not isinstance(roles, list) or any(not isinstance(role, str) for role in roles):
            raise ValueError('invalid_discord_roles')
        profile['_guild_member'] = settings.DISCORD_MEMBER_ROLE_ID in roles and not member.get('pending', False)
        profile['_guild_role_ids'] = [] if member.get('pending', False) else roles
    return profile


def discord_user(profile):
    discord_id, username = profile.get('id'), profile.get('username')
    if not isinstance(discord_id, str) or not re.fullmatch(r'[0-9]{1,20}', discord_id):
        raise ValueError('invalid_discord_id')
    if not isinstance(username, str) or not username or len(username) > 100:
        raise ValueError('invalid_discord_username')
    name = profile.get('global_name') or username
    if not isinstance(name, str):
        raise ValueError('invalid_discord_name')
    email = profile.get('email') if profile.get('verified') is True else ''
    if not isinstance(email, str) or len(email) > 254:
        email = ''
    avatar = profile.get('avatar') or ''
    if not isinstance(avatar, str) or not re.fullmatch(r'(a_)?[a-f0-9]{32}', avatar):
        avatar = ''
    try:
        with transaction.atomic():
            account = DiscordAccount.objects.select_related('user').filter(discord_id=discord_id).first()
            if account is None:
                # Never match local accounts by email/name, including the bootstrap admin.
                user = get_user_model().objects.create_user(
                    username=f'discord_{discord_id}_{secrets.token_hex(4)}', email=email,
                    first_name=name[:150], password=None,
                )
                account = DiscordAccount.objects.create(user=user, discord_id=discord_id, username=username, display_name=name[:100], avatar=avatar)
                if membership_required() and profile.get('_guild_member') is not True:
                    # A new pending account receives its initial role only after approval.
                    user.guild_roles.clear()
    except IntegrityError:
        # Two first-time callbacks for the same Discord ID can arrive together.
        account = DiscordAccount.objects.select_related('user').get(discord_id=discord_id)
    user = account.user
    if not user.is_active:
        return None
    if not membership_required() or profile.get('_guild_member') is True:
        first_membership = not account.is_member or account.guild_id != settings.DISCORD_GUILD_ID
        if first_membership and not user.guild_roles.exists():
            role = GuildRole.objects.filter(is_default=True).first()
            if role:
                role.members.add(user)
    account.is_member = not membership_required() or profile.get('_guild_member') is True
    account.guild_id = settings.DISCORD_GUILD_ID
    account.username, account.display_name, account.avatar = username, name[:100], avatar
    account.save(update_fields=['username', 'display_name', 'avatar', 'guild_id', 'is_member', 'updated_at'])
    if membership_required() and '_guild_role_ids' in profile:
        automatic_roles = GuildRole.objects.filter(
            discord_role_id__in=profile['_guild_role_ids'],
        ).exclude(discord_role_id='') if site_access(user) else GuildRole.objects.none()
        # Only replace Discord assignments; manual assignments remain intact.
        user.discord_guild_roles.set(automatic_roles)
    user.first_name, user.email = name[:150], email
    user.save(update_fields=['first_name', 'email'])
    return user


@never_cache
@require_GET
@sensitive_variables('code', 'profile')
def discord_callback(request):
    attempts = request.session.get(SESSION_KEY, {}).copy()
    attempt = attempts.pop(request.GET.get('state', ''), None)
    request.session[SESSION_KEY] = attempts
    if not attempt or time.time() - attempt['created'] > 600:
        return auth_error('expired')
    if request.GET.get('error'):
        return auth_error('cancelled')
    code = request.GET.get('code')
    if not discord_enabled() or not code or request.GET.get('iss', 'https://discord.com') != 'https://discord.com':
        return auth_error('failed')
    try:
        profile = discord_profile(code)
        user = discord_user(profile)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        return auth_error('failed')
    if user is None:
        return auth_error('inactive')
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    if not site_access(user):
        return redirect('/')
    return redirect(safe_next(request, attempt['next']))


@never_cache
@require_POST
def sign_out(request):
    logout(request)
    return redirect('/')
