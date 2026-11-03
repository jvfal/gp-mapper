"""Session-authenticated maps with separate viewing, editing and ownership."""

import json
import math
from datetime import datetime, timezone

from django.db import transaction
from django.db.models import Count
from django.contrib.auth import get_user_model
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from catalog.models import RoadMap
from .models import Board, BoardAccess, BoardConnection, BoardNode
from .permissions import permissions, visible_boards
from .broadcast import publish_board


def summary(board, user):
    node_count = getattr(board, 'node_count', None)
    connection_count = getattr(board, 'connection_count', None)
    return {
        'id': str(board.pk), 'name': board.name, 'revision': board.revision,
        'scope': board.scope, 'permissions': permissions(board, user),
        'updatedAt': board.updated_at.isoformat(),
        'nodeCount': board.nodes.count() if node_count is None else node_count,
        'connectionCount': board.connections.count() if connection_count is None else connection_count,
    }


def state(board):
    nodes = list(board.nodes.all())
    node_ids = {node.pk: f'map-{node.road_map_id}' for node in nodes}
    return {
        'version': 1,
        'nodes': [{'id': node_ids[node.pk], 'mapId': node.road_map_id,
                   'position': {'x': node.x, 'y': node.y}} for node in nodes],
        'edges': [{'id': edge.client_id, 'source': node_ids[edge.source_id],
                   'target': node_ids[edge.target_id], 'sourceHandle': edge.source_handle,
                   'targetHandle': edge.target_handle, 'expiresAt': round(edge.expires_at.timestamp() * 1000)}
                  for edge in board.connections.all()],
        'viewport': {'x': board.viewport_x, 'y': board.viewport_y, 'zoom': board.viewport_zoom},
        'canvasWidth': board.canvas_width,
    }


def body(request):
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('invalid_payload')
    if not isinstance(data, dict):
        raise ValueError('invalid_payload')
    return data


def name_from(data):
    name = data.get('name')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
        raise ValueError('invalid_name')
    return name.strip()


def number(value, limit=10_000_000):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > limit:
        raise ValueError('invalid_state')
    return value


def validate_state(data):
    if not isinstance(data, dict) or data.get('version') != 1:
        raise ValueError('invalid_state')
    nodes, edges = data.get('nodes'), data.get('edges')
    if not isinstance(nodes, list) or not isinstance(edges, list) or len(nodes) > 2000 or len(edges) > 5000:
        raise ValueError('invalid_state')
    clean_nodes, ids = [], set()
    for node in nodes:
        if not isinstance(node, dict) or type(node.get('mapId')) is not int:
            raise ValueError('invalid_state')
        map_id = node['mapId']
        if node.get('id') != f'map-{map_id}' or map_id in ids or not isinstance(node.get('position'), dict):
            raise ValueError('invalid_state')
        ids.add(map_id)
        clean_nodes.append((map_id, number(node['position'].get('x')), number(node['position'].get('y'))))
    if RoadMap.objects.filter(pk__in=ids).count() != len(ids):
        raise ValueError('invalid_map')
    known = {f'map-{map_id}': map_id for map_id in ids}
    clean_edges, edge_ids, pairs = [], set(), set()
    for edge in edges:
        if not isinstance(edge, dict):
            raise ValueError('invalid_state')
        client_id, source, target = edge.get('id'), edge.get('source'), edge.get('target')
        if not isinstance(client_id, str) or not 1 <= len(client_id) <= 100 or client_id in edge_ids:
            raise ValueError('invalid_state')
        if not isinstance(source, str) or not isinstance(target, str) or source not in known or target not in known or source == target:
            raise ValueError('invalid_state')
        pair = tuple(sorted((known[source], known[target])))
        if pair in pairs:
            raise ValueError('duplicate_connection')
        source_handle, target_handle = edge.get('sourceHandle'), edge.get('targetHandle')
        if source_handle not in BoardConnection.Handle.values or target_handle not in BoardConnection.Handle.values:
            raise ValueError('invalid_state')
        timestamp = number(edge.get('expiresAt'), limit=253_402_300_799_000)
        try:
            expires_at = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
        except (ValueError, OverflowError, OSError):
            raise ValueError('invalid_state')
        # Canonical direction also prevents duplicate undirected connections.
        source_id, target_id = known[source], known[target]
        if source_id > target_id:
            source_id, target_id, source_handle, target_handle = target_id, source_id, target_handle, source_handle
        clean_edges.append((client_id, source_id, target_id, source_handle, target_handle, expires_at))
        pairs.add(pair)
        edge_ids.add(client_id)
    viewport = data.get('viewport')
    if not isinstance(viewport, dict):
        raise ValueError('invalid_state')
    x, y, zoom = (number(viewport.get(key)) for key in ['x', 'y', 'zoom'])
    if not .25 <= zoom <= 1.8:
        raise ValueError('invalid_state')
    width = data.get('canvasWidth')
    if width is not None and (type(width) is not int or not 0 < width <= 100_000):
        raise ValueError('invalid_state')
    return clean_nodes, clean_edges, (x, y, zoom, width)


def replace_state(board, validated):
    nodes, edges, viewport = validated
    board.connections.all().delete()
    board.nodes.exclude(road_map_id__in=[node[0] for node in nodes]).delete()
    BoardNode.objects.bulk_create(
        [BoardNode(board=board, road_map_id=map_id, x=x, y=y) for map_id, x, y in nodes],
        update_conflicts=True, update_fields=['x', 'y'], unique_fields=['board', 'road_map'],
    )
    by_map = {node.road_map_id: node for node in board.nodes.all()}
    BoardConnection.objects.bulk_create([
        BoardConnection(board=board, client_id=client_id, source=by_map[source], target=by_map[target],
                        source_handle=source_handle, target_handle=target_handle, expires_at=expires_at)
        for client_id, source, target, source_handle, target_handle, expires_at in edges
    ])
    board.viewport_x, board.viewport_y, board.viewport_zoom, board.canvas_width = viewport
    board.revision += 1
    board.save()


@never_cache
@require_http_methods(['GET', 'POST'])
def boards(request):
    if not request.user.is_authenticated:
        return JsonResponse({'user': None, 'boards': []}) if request.method == 'GET' else JsonResponse({'error': 'authentication_required'}, status=401)
    if request.method == 'GET':
        queryset = visible_boards(request.user).annotate(node_count=Count('nodes', distinct=True), connection_count=Count('connections', distinct=True))
        return JsonResponse({'user': {'id': request.user.pk, 'name': request.user.get_username()},
                             'boards': [summary(board, request.user) for board in queryset]})
    try:
        data = body(request)
        name = name_from(data)
        scope = data.get('scope', Board.Scope.PRIVATE)
        if scope not in Board.Scope.values:
            raise ValueError('invalid_scope')
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=400)
    with transaction.atomic():
        board = Board.objects.create(owner=request.user, name=name, scope=scope)
    return JsonResponse({'board': {**summary(board, request.user), 'state': state(board)}}, status=201)


@never_cache
@require_http_methods(['GET', 'PUT', 'PATCH'])
def board_detail(request, board_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'authentication_required'}, status=401)
    # Lock both reads and writes so state and revision are always a single snapshot.
    with transaction.atomic():
        board = get_object_or_404(Board.objects.select_for_update(), pk=board_id)
        access = permissions(board, request.user)
        if not access['canView']:
            raise Http404
        if request.method == 'GET':
            return JsonResponse({'board': {**summary(board, request.user), 'state': state(board)}})
        if not access['canEdit'] or request.method == 'PATCH' and not access['canManage']:
            return JsonResponse({'error': 'permission_denied'}, status=403)
        try:
            data = body(request)
            if request.method == 'PATCH':
                board.name = name_from(data)
                board.save(update_fields=['name', 'updated_at'])
            else:
                if type(data.get('revision')) is not int:
                    raise ValueError('invalid_revision')
                if data['revision'] != board.revision:
                    return JsonResponse({'error': 'revision_conflict'}, status=409)
                replace_state(board, validate_state(data.get('state')))
        except ValueError as error:
            return JsonResponse({'error': str(error)}, status=400)
        publish_board(board.pk)
        return JsonResponse({'board': summary(board, request.user)})


def access_settings(board):
    grants = {grant.user_id: grant for grant in board.access_grants.all()}
    return {
        'scope': board.scope, 'guildCanView': board.guild_can_view, 'guildCanEdit': board.guild_can_edit,
        'users': [{'id': user.pk, 'name': user.get_username(),
                   'canView': bool(grants.get(user.pk) and grants[user.pk].can_view),
                   'canEdit': bool(grants.get(user.pk) and grants[user.pk].can_edit)}
                  for user in get_user_model().objects.filter(is_active=True).exclude(pk=board.owner_id).order_by('username')],
    }


@never_cache
@require_http_methods(['GET', 'PUT'])
def board_access(request, board_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'authentication_required'}, status=401)
    with transaction.atomic():
        board = get_object_or_404(Board.objects.select_for_update(), pk=board_id, owner=request.user)
        if request.method == 'PUT':
            try:
                data = body(request)
                scope, guild_view, guild_edit = data.get('scope'), data.get('guildCanView'), data.get('guildCanEdit')
                if scope not in Board.Scope.values or type(guild_view) is not bool or type(guild_edit) is not bool or guild_edit and not guild_view:
                    raise ValueError('invalid_access')
                grants = data.get('users')
                if not isinstance(grants, list) or len(grants) > 5000:
                    raise ValueError('invalid_access')
                ids, clean = set(), []
                for grant in grants:
                    if not isinstance(grant, dict) or type(grant.get('id')) is not int:
                        raise ValueError('invalid_access')
                    user_id, view, edit = grant['id'], grant.get('canView'), grant.get('canEdit')
                    if user_id == board.owner_id or user_id in ids or type(view) is not bool or type(edit) is not bool or edit and not view:
                        raise ValueError('invalid_access')
                    ids.add(user_id)
                    if view:
                        clean.append(BoardAccess(board=board, user_id=user_id, can_view=view, can_edit=edit))
                if get_user_model().objects.filter(pk__in=ids, is_active=True).count() != len(ids):
                    raise ValueError('invalid_access')
            except ValueError as error:
                return JsonResponse({'error': str(error)}, status=400)
            board.scope, board.guild_can_view, board.guild_can_edit = scope, guild_view, guild_edit
            board.save(update_fields=['scope', 'guild_can_view', 'guild_can_edit', 'updated_at'])
            board.access_grants.all().delete()
            if scope == Board.Scope.GUILD:
                BoardAccess.objects.bulk_create(clean)
            publish_board(board.pk)
        return JsonResponse({'access': access_settings(board), 'board': summary(board, request.user)})
