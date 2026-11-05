import uuid

from django.conf import settings
from django.db import models
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator


class MemberActivity(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mapper_activity')
    last_access_at = models.DateTimeField()


class DiscordAccount(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='discord_account')
    discord_id = models.CharField(max_length=20, unique=True)
    username = models.CharField(max_length=100)
    display_name = models.CharField(max_length=100)
    avatar = models.CharField(max_length=100, blank=True)
    guild_id = models.CharField(max_length=20, blank=True)
    is_member = models.BooleanField(default=False)
    manually_approved = models.BooleanField(default=False)
    approval_guild_id = models.CharField(max_length=20, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='approved_discord_accounts',
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.display_name


class GuildRole(models.Model):
    name = models.CharField(max_length=60, unique=True)
    members = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='guild_roles', blank=True)
    discord_role_id = models.CharField(
        max_length=20, blank=True,
        validators=[RegexValidator(r'^[0-9]{1,20}$', 'Informe um ID de cargo válido.')],
    )
    discord_members = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name='discord_guild_roles', blank=True,
    )
    is_default = models.BooleanField(default=False)
    can_view_guild_maps = models.BooleanField(default=True)
    can_create_guild_maps = models.BooleanField(default=False)
    can_delete_guild_maps = models.BooleanField(default=False)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['is_default'], condition=models.Q(is_default=True), name='mapper_one_default_role'),
            models.CheckConstraint(condition=models.Q(can_create_guild_maps=False) | models.Q(can_view_guild_maps=True), name='mapper_create_requires_view'),
            models.CheckConstraint(condition=models.Q(can_delete_guild_maps=False) | models.Q(can_view_guild_maps=True), name='mapper_delete_requires_view'),
        ]

    def __str__(self):
        return self.name


class GuildBranding(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    icon_data = models.BinaryField(default=bytes, blank=True)
    icon_digest = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name='mapper_single_branding')]


class GuildModule(models.Model):
    class Code(models.TextChoices):
        MAPPER = 'mapper', 'Mapeador'

    code = models.CharField(max_length=30, primary_key=True, choices=Code.choices)
    enabled = models.BooleanField(default=True)


class MapperModuleSettings(models.Model):
    module = models.OneToOneField(GuildModule, on_delete=models.CASCADE, related_name='mapper_settings')
    discord_channel_id = models.CharField(
        max_length=20, blank=True,
        validators=[RegexValidator(r'^[0-9]{1,20}$', 'Informe um ID de canal válido.')],
    )
    warning_minutes = models.PositiveSmallIntegerField(
        default=15, validators=[MinValueValidator(1), MaxValueValidator(120)],
    )
    bot_last_seen = models.DateTimeField(null=True, blank=True)
    bot_checked_at = models.DateTimeField(null=True, blank=True)
    bot_last_error = models.CharField(max_length=40, blank=True)
    bot_retry_at = models.DateTimeField(null=True, blank=True)
    discord_channel_name = models.CharField(max_length=100, blank=True)
    discord_channel_configured_at = models.DateTimeField(null=True, blank=True)


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


class GraphAttribution(models.Model):
    # Historical items have no known author/date; do not invent attribution.
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True


class BoardNode(GraphAttribution):
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='nodes')
    road_map = models.ForeignKey('catalog.RoadMap', on_delete=models.PROTECT)
    x = models.FloatField(default=0)
    y = models.FloatField(default=0)
    is_home = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['board', 'road_map'], name='mapper_node_unique_map')]


class BoardConnection(GraphAttribution):
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
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['board', 'client_id'], name='mapper_edge_unique_id'),
            models.UniqueConstraint(fields=['board', 'source', 'target'], name='mapper_edge_unique_pair'),
            models.CheckConstraint(condition=~models.Q(source=models.F('target')), name='mapper_edge_different_nodes'),
            models.CheckConstraint(condition=models.Q(source_handle__in=['top', 'bottom', 'left', 'right']), name='mapper_edge_source_handle'),
            models.CheckConstraint(condition=models.Q(target_handle__in=['top', 'bottom', 'left', 'right']), name='mapper_edge_target_handle'),
        ]


class RouteNotification(models.Model):
    class Kind(models.TextChoices):
        WARNING = 'warning', 'Warning'
        EXPIRED = 'expired', 'Expired'

    # Connections may be deleted/recreated when edited: use their stable client ID.
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name='route_notifications')
    connection_id = models.CharField(max_length=100)
    expires_at = models.DateTimeField()
    kind = models.CharField(max_length=7, choices=Kind.choices)
    sent_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.CharField(max_length=40, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['board', 'connection_id', 'expires_at', 'kind'], name='mapper_route_notification_unique',
        )]
