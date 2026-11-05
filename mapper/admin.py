from django.contrib import admin
from django.db.models import Count

from .models import Board, BoardAccess, BoardConnection, BoardNode


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class BoardNodeInline(ReadOnlyInline):
    model = BoardNode
    fields = readonly_fields = ('road_map', 'x', 'y')

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('road_map')


class BoardConnectionInline(ReadOnlyInline):
    model = BoardConnection
    fields = readonly_fields = ('origin', 'destination', 'source_handle', 'target_handle', 'expires_at')

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('source__road_map', 'target__road_map')

    @admin.display(description='Origem')
    def origin(self, obj):
        return obj.source.road_map.name

    @admin.display(description='Destino')
    def destination(self, obj):
        return obj.target.road_map.name


class BoardAccessInline(ReadOnlyInline):
    model = BoardAccess
    fields = readonly_fields = ('user', 'can_view', 'can_edit')

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('user')


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'scope', 'node_count', 'connection_count', 'updated_at')
    list_filter = ('scope',)
    search_fields = ('name', 'owner__username', 'owner__email', 'owner__discord_account__display_name')
    list_select_related = ('owner',)
    ordering = ('-updated_at',)
    readonly_fields = (
        'id', 'name', 'owner', 'scope', 'guild_can_view', 'guild_can_edit',
        'revision', 'created_at', 'updated_at', 'viewport_x', 'viewport_y',
        'viewport_zoom', 'canvas_width',
    )
    fields = readonly_fields
    inlines = (BoardAccessInline, BoardNodeInline, BoardConnectionInline)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            total_nodes=Count('nodes', distinct=True),
            total_connections=Count('connections', distinct=True),
        )

    @admin.display(description='Mapas', ordering='total_nodes')
    def node_count(self, obj):
        return obj.total_nodes

    @admin.display(description='Conexões', ordering='total_connections')
    def connection_count(self, obj):
        return obj.total_connections

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
