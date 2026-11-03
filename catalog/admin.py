from django.contrib import admin
from django.templatetags.static import static
from django.utils.html import format_html

from .models import MapChest, MapDungeon, MapResource, RoadMap


class MapResourceInline(admin.TabularInline):
    model = MapResource
    extra = 0


class MapChestInline(admin.TabularInline):
    model = MapChest
    extra = 0


class MapDungeonInline(admin.TabularInline):
    model = MapDungeon
    extra = 0


@admin.register(RoadMap)
class RoadMapAdmin(admin.ModelAdmin):
    list_display = ['name', 'tier']
    list_filter = ['tier']
    search_fields = ['name']
    readonly_fields = ['image_preview']
    inlines = [MapResourceInline, MapChestInline, MapDungeonInline]

    @admin.display(description='Imagem do mapa')
    def image_preview(self, obj):
        if obj is None or not obj.image:
            return 'Sem imagem'
        return format_html(
            '<img src="{}" alt="{}" width="320" loading="lazy">',
            static(obj.image_static_path), obj.name,
        )
