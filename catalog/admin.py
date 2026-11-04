from django.contrib import admin

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
    list_display = ['name', 'tier', 'is_active']
    list_filter = ['tier', 'is_active']
    search_fields = ['name']
    exclude = ['image']
    inlines = [MapResourceInline, MapChestInline, MapDungeonInline]
