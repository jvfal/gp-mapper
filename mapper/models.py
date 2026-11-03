import uuid

from django.conf import settings
from django.db import models


class Board(models.Model):
    class Scope(models.TextChoices):
        PRIVATE = 'private', 'Private'
        GUILD = 'guild', 'Guild'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mapper_boards')
    name = models.CharField(max_length=100)
    scope = models.CharField(max_length=7, choices=Scope.choices, default=Scope.PRIVATE)
    guild_can_view = models.BooleanField(default=True)
    guild_can_edit = models.BooleanField(default=False)
    viewport_x = models.FloatField(default=0)
    viewport_y = models.FloatField(default=0)
    viewport_zoom = models.FloatField(default=1)
    canvas_width = models.PositiveIntegerField(null=True, blank=True)
    revision = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at', 'id']
        constraints = [models.CheckConstraint(
            condition=models.Q(guild_can_edit=False) | models.Q(guild_can_view=True),
            name='mapper_guild_edit_requires_view',
        )]

    def __str__(self):
        return self.name


class BoardAccess(models.Model):
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='access_grants')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mapper_access')
    can_view = models.BooleanField(default=True)
    can_edit = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['board', 'user'], name='mapper_access_unique_user'),
            models.CheckConstraint(condition=models.Q(can_edit=False) | models.Q(can_view=True), name='mapper_access_edit_requires_view'),
        ]


class BoardMutation(models.Model):
    """Acknowledged batches, so reconnecting cannot apply a write twice."""
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='mutations')
    mutation_id = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['board', 'mutation_id'], name='mapper_mutation_unique')]


class BoardNode(models.Model):
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='nodes')
    road_map = models.ForeignKey('catalog.RoadMap', on_delete=models.PROTECT)
    x = models.FloatField(default=0)
    y = models.FloatField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['board', 'road_map'], name='mapper_node_unique_map')]


class BoardConnection(models.Model):
    class Handle(models.TextChoices):
        TOP = 'top', 'Top'
        BOTTOM = 'bottom', 'Bottom'
        LEFT = 'left', 'Left'
        RIGHT = 'right', 'Right'

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='connections')
    client_id = models.CharField(max_length=100)
    source = models.ForeignKey(BoardNode, on_delete=models.CASCADE, related_name='outgoing')
    target = models.ForeignKey(BoardNode, on_delete=models.CASCADE, related_name='incoming')
    source_handle = models.CharField(max_length=6, choices=Handle.choices)
    target_handle = models.CharField(max_length=6, choices=Handle.choices)
    expires_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['board', 'client_id'], name='mapper_edge_unique_id'),
            models.UniqueConstraint(fields=['board', 'source', 'target'], name='mapper_edge_unique_pair'),
            models.CheckConstraint(condition=~models.Q(source=models.F('target')), name='mapper_edge_different_nodes'),
            models.CheckConstraint(condition=models.Q(source_handle__in=['top', 'bottom', 'left', 'right']), name='mapper_edge_source_handle'),
            models.CheckConstraint(condition=models.Q(target_handle__in=['top', 'bottom', 'left', 'right']), name='mapper_edge_target_handle'),
        ]
