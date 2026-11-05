"""Atomic operation batches: unrelated edits merge, deletes beat stale moves."""
from copy import deepcopy
from importlib import import_module
from types import SimpleNamespace
from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user
from django.db import transaction

from .boards import number, state, summary, validate_state
from .broadcast import publish_board
from .models import Board, BoardMutation
from .graph_storage import persist_graph
from .permissions import permissions


class AccessDenied(Exception):
    pass


def session_user(session_key):
    # Reload the session on every sync/write, including logout or expiry elsewhere.
    store = import_module(settings.SESSION_ENGINE).SessionStore(session_key=session_key)
    user = get_user(SimpleNamespace(session=store))
    if not user.is_authenticated or not user.is_active:
        raise AccessDenied('authentication_required')
    return user


def locked_board(board_id, user):
    try:
        board = Board.objects.select_for_update().get(pk=board_id)
    except Board.DoesNotExist:
        raise AccessDenied('board_deleted')
    if not permissions(board, user)['canView']:
        raise AccessDenied('permission_denied')
    return board


def snapshot(board, user):
    return {**summary(board, user), 'state': state(board)}


def read_board(board_id, session_key):
    with transaction.atomic():
        user = session_user(session_key)
        return snapshot(locked_board(board_id, user), user)


def apply_operations(current, operations):
    if not isinstance(operations, list) or not 1 <= len(operations) <= 256:
        raise ValueError('invalid_operations')
    nodes = {node['id']: deepcopy(node) for node in current['nodes']}
    edges = {edge['id']: deepcopy(edge) for edge in current['edges']}
    for operation in operations:
        if not isinstance(operation, dict):
            raise ValueError('invalid_operations')
        kind = operation.get('type')
        if kind in ('node.add', 'node.move', 'node.remove'):
            map_id = operation.get('mapId')
            if type(map_id) is not int or not 0 < map_id <= 2_147_483_647:
                raise ValueError('invalid_operations')
            node_id = f'map-{map_id}'
            if kind == 'node.remove':
                nodes.pop(node_id, None)
                edges = {key: edge for key, edge in edges.items() if node_id not in (edge['source'], edge['target'])}
                continue
            position = operation.get('position')
            if not isinstance(position, dict):
                raise ValueError('invalid_operations')
            position = {'x': number(position.get('x')), 'y': number(position.get('y'))}
            if kind == 'node.add' and node_id not in nodes:
                nodes[node_id] = {'id': node_id, 'mapId': map_id, 'position': position}
            elif kind == 'node.move' and node_id in nodes:
                nodes[node_id]['position'] = position
        elif kind in ('edge.add', 'edge.update', 'edge.remove'):
            edge = operation.get('edge')
            edge_id = operation.get('id') if kind == 'edge.remove' else edge.get('id') if isinstance(edge, dict) else None
            if not isinstance(edge_id, str) or not 1 <= len(edge_id) <= 100:
                raise ValueError('invalid_operations')
            if kind == 'edge.remove':
                edges.pop(edge_id, None)
                continue
            source, target = edge.get('source'), edge.get('target')
            if not isinstance(source, str) or not isinstance(target, str):
                raise ValueError('invalid_operations')
            if source not in nodes or target not in nodes:
                continue  # A concurrent node deletion wins over an old edge edit.
            if kind == 'edge.add' and edge_id in edges or kind == 'edge.update' and edge_id not in edges:
                continue
            if any(other['id'] != edge_id and {source, target} == {other['source'], other['target']} for other in edges.values()):
                continue
            edges[edge_id] = deepcopy(edge)
        else:
            raise ValueError('invalid_operations')
    return {**current, 'nodes': list(nodes.values()), 'edges': list(edges.values())}


def save_delta(board, validated, user):
    nodes, edges, _ = validated
    if not persist_graph(board, nodes, edges, user):
        return False
    board.revision += 1
    board.save(update_fields=['revision', 'updated_at'])
    return True


def mutate_board(board_id, session_key, mutation_id, operations):
    try:
        mutation_id = UUID(str(mutation_id))
    except (ValueError, TypeError, AttributeError):
        raise ValueError('invalid_mutation_id')
    with transaction.atomic():
        user = session_user(session_key)
        board = locked_board(board_id, user)
        if not permissions(board, user)['canEdit']:
            raise AccessDenied('permission_denied')
        if not BoardMutation.objects.filter(board=board, mutation_id=mutation_id).exists():
            current = state(board)
            candidate = apply_operations(current, operations)
            changed = save_delta(board, validate_state(candidate), user)
            BoardMutation.objects.create(board=board, mutation_id=mutation_id)
            if changed:
                publish_board(board.pk)
        return snapshot(board, user)
