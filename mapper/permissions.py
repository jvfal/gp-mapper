"""One guild per deployment: members are the active users of this installation."""

from django.db.models import Exists, OuterRef, Q

from .models import Board, BoardAccess


def visible_boards(user):
    if not user.is_authenticated or not user.is_active:
        return Board.objects.none()
    return Board.objects.annotate(
        member_can_view=Exists(BoardAccess.objects.filter(board_id=OuterRef('pk'), user=user, can_view=True)),
        member_can_edit=Exists(BoardAccess.objects.filter(board_id=OuterRef('pk'), user=user, can_edit=True)),
    ).filter(Q(owner=user) | Q(scope=Board.Scope.GUILD) & (Q(guild_can_view=True) | Q(member_can_view=True)))


def permissions(board, user):
    owner = user.is_authenticated and user.is_active and board.owner_id == user.pk
    if owner:
        return {'canView': True, 'canEdit': True, 'canManage': True}
    if not user.is_authenticated or not user.is_active or board.scope != Board.Scope.GUILD:
        return {'canView': False, 'canEdit': False, 'canManage': False}
    member_view = getattr(board, 'member_can_view', None)
    member_edit = getattr(board, 'member_can_edit', None)
    if member_view is None or member_edit is None:
        grant = board.access_grants.filter(user=user).first()
        member_view, member_edit = bool(grant and grant.can_view), bool(grant and grant.can_edit)
    view = board.guild_can_view or member_view
    return {'canView': view, 'canEdit': view and (board.guild_can_edit or member_edit), 'canManage': False}
