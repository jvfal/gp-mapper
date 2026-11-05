"""Persist changed graph items and server-owned attribution under the board lock."""
from django.utils import timezone

from .models import BoardConnection, BoardNode


def persist_graph(board, nodes, edges, user):
    existing_nodes = {node.road_map_id: node for node in board.nodes.all()}
    by_id = {node.pk: node.road_map_id for node in existing_nodes.values()}
    existing_edges = {edge.client_id: edge for edge in board.connections.all()}
    old_nodes = {key: (node.x, node.y, node.is_home) for key, node in existing_nodes.items()}
    new_nodes = {key: (x, y, home) for key, x, y, home in nodes}
    old_edges = {key: (by_id[edge.source_id], by_id[edge.target_id], edge.source_handle, edge.target_handle, edge.expires_at)
                 for key, edge in existing_edges.items()}
    new_edges = {key: (source, target, sh, th, expiry) for key, source, target, sh, th, expiry in edges}
    if old_nodes == new_nodes and old_edges == new_edges:
        return False
    now = timezone.now()
    changed_edges = {key for key in old_edges.keys() | new_edges.keys() if old_edges.get(key) != new_edges.get(key)}
    # Delete before inserting to allow canonical pairs/handles to change atomically.
    board.connections.filter(client_id__in=changed_edges).delete()
    board.nodes.filter(road_map_id__in=old_nodes.keys() - new_nodes.keys()).delete()
    BoardNode.objects.bulk_create([
        BoardNode(board=board, road_map_id=key, x=xy[0], y=xy[1], is_home=xy[2],
                  created_by=user, created_at=now, updated_by=user, updated_at=now)
        for key, xy in new_nodes.items() if old_nodes.get(key) != xy
    ], update_conflicts=True, update_fields=['x', 'y', 'is_home', 'updated_by', 'updated_at'], unique_fields=['board', 'road_map'])
    if changed_edges:
        by_map = {node.road_map_id: node for node in board.nodes.all()}
        BoardConnection.objects.bulk_create([
            BoardConnection(board=board, client_id=key, source=by_map[source], target=by_map[target],
                            source_handle=sh, target_handle=th, expires_at=expiry,
                            created_by_id=existing_edges[key].created_by_id if key in existing_edges else user.pk,
                            created_at=existing_edges[key].created_at if key in existing_edges else now,
                            updated_by=user, updated_at=now)
            for key, source, target, sh, th, expiry in edges if key in changed_edges
        ])
    return True
