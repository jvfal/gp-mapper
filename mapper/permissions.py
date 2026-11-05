"""One guild per deployment: members are the active users of this installation."""

from django.db.models import Exists, OuterRef, Q

from .models import Board, BoardAccess
from .roles import guild_permissions, is_guild_master, site_access
from .modules import mapper_enabled


def visible_boards(user):
    if not site_access(user) or not mapper_enabled(user):
        return Board.objects.none()
    queryset = Board.objects.annotate(
        member_can_view=Exists(BoardAccess.objects.filter(board_id=OuterRef('pk'), user=user, can_view=True)),
        member_can_edit=Exists(BoardAccess.objects.filter(board_id=OuterRef('pk'), user=user, can_edit=True)),
    )
    if not guild_permissions(user)['canViewGuildMaps']:
        return queryset.filter(owner=user, scope=Board.Scope.PRIVATE)
    if is_guild_master(user):
        return queryset.filter(Q(owner=user) | Q(scope=Board.Scope.GUILD))
    return queryset.filter(Q(owner=user) | Q(scope=Board.Scope.GUILD) & (Q(guild_can_view=True) | Q(member_can_view=True)))


def permissions(board, user):
    if not site_access(user) or not mapper_enabled(user) or (board.scope == Board.Scope.GUILD and not guild_permissions(user)['canViewGuildMaps']):
        return {'canView': False, 'canEdit': False, 'canManage': False}
    owner = user.is_authenticated and user.is_active and board.owner_id == user.pk
    if owner:
        return {'canView': True, 'canEdit': True, 'canManage': True}
    if not user.is_authenticated or not user.is_active or board.scope != Board.Scope.GUILD:
        return {'canView': False, 'canEdit': False, 'canManage': False}
    if is_guild_master(user):
        return {'canView': True, 'canEdit': True, 'canManage': True}
    member_view = getattr(board, 'member_can_view', None)
    member_edit = getattr(board, 'member_can_edit', None)
    if member_view is None or member_edit is None:
        grant = board.access_grants.filter(user=user).first()
        member_view, member_edit = bool(grant and grant.can_view), bool(grant and grant.can_edit)
    view = board.guild_can_view or member_view
    return {'canView': view, 'canEdit': view and (board.guild_can_edit or member_edit), 'canManage': False}


def can_delete(board, user, access=None):
    if not (access if access is not None else permissions(board, user))['canView']:
        return False
    return board.owner_id == user.pk or (
        board.scope == Board.Scope.GUILD and guild_permissions(user)['canDeleteGuildMaps']
    )
