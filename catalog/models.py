from django.core.validators import MinValueValidator, RegexValidator
from django.db import models


class Size(models.TextChoices):
    SMALL = 'small', 'Pequeno'
    LARGE = 'large', 'Grande'


class RoadMap(models.Model):
    class Tier(models.IntegerChoices):
        FOUR = 4, 'T4'
        SIX = 6, 'T6'
        EIGHT = 8, 'T8'

    # Stable identifier from maps.json; shared mappers will reference this catalog.
    id = models.PositiveIntegerField(primary_key=True, validators=[MinValueValidator(1)])
    name = models.CharField('nome', max_length=100, unique=True)
    tier = models.PositiveSmallIntegerField(choices=Tier.choices, db_index=True)
    image = models.CharField(
        'arquivo da imagem', max_length=255, blank=True,
        validators=[RegexValidator(r'^[A-Za-z0-9_-]+\.png$', 'Informe apenas o nome do PNG.')],
    )

    class Meta:
        ordering = ['name']
        verbose_name = 'mapa'
        verbose_name_plural = 'mapas'
        constraints = [
            models.CheckConstraint(condition=models.Q(id__gt=0), name='catalog_map_id_positive'),
            models.CheckConstraint(condition=models.Q(tier__in=[4, 6, 8]), name='catalog_map_tier_valid'),
        ]

    @property
    def image_static_path(self):
        return f'avalon/maps/{self.image}' if self.image else ''

    def __str__(self):
        return f'{self.name} (T{self.tier})'


class MapFeature(models.Model):
    size = models.CharField('tamanho', max_length=5, choices=Size.choices)
    count = models.PositiveSmallIntegerField('quantidade', validators=[MinValueValidator(1)])

    class Meta:
        abstract = True
        constraints = [
            models.CheckConstraint(
                condition=models.Q(count__gt=0), name='%(app_label)s_%(class)s_count_positive',
            ),
            models.CheckConstraint(
                condition=models.Q(size__in=Size.values), name='%(app_label)s_%(class)s_size_valid',
            ),
        ]


class MapResource(MapFeature):
    class ResourceType(models.TextChoices):
        WOOD = 'WOOD', 'Madeira'
        STONE = 'STONE', 'Pedra'
        ORE = 'ORE', 'Minério'
        HIDE = 'HIDE', 'Couro'
        FIBER = 'FIBER', 'Fibra'

    road_map = models.ForeignKey(RoadMap, on_delete=models.CASCADE, related_name='resources')
    resource_type = models.CharField('recurso', max_length=10, choices=ResourceType.choices)

    class Meta(MapFeature.Meta):
        abstract = False
        ordering = ['resource_type', 'size']
        verbose_name = 'recurso'
        verbose_name_plural = 'recursos'
        constraints = MapFeature.Meta.constraints + [
            models.UniqueConstraint(
                fields=['road_map', 'resource_type', 'size'], name='catalog_resource_unique',
            ),
            models.CheckConstraint(
                condition=models.Q(resource_type__in=['WOOD', 'STONE', 'ORE', 'HIDE', 'FIBER']),
                name='catalog_resource_type_valid',
            ),
        ]

    @property
    def icon_static_path(self):
        return f'avalon/icons/resource_{self.resource_type.lower()}.png'

    def __str__(self):
        return f'{self.get_resource_type_display()} ({self.get_size_display()}) × {self.count}'


class MapChest(MapFeature):
    class ChestType(models.TextChoices):
        GREEN = 'GREEN', 'Verde'
        BLUE = 'BLUE', 'Azul'
        GOLD = 'GOLD', 'Dourado'

    road_map = models.ForeignKey(RoadMap, on_delete=models.CASCADE, related_name='chests')
    chest_type = models.CharField('baú', max_length=10, choices=ChestType.choices)

    class Meta(MapFeature.Meta):
        abstract = False
        ordering = ['chest_type', 'size']
        verbose_name = 'baú'
        verbose_name_plural = 'baús'
        constraints = MapFeature.Meta.constraints + [
            models.UniqueConstraint(
                fields=['road_map', 'chest_type', 'size'], name='catalog_chest_unique',
            ),
            models.CheckConstraint(
                condition=models.Q(chest_type__in=['GREEN', 'BLUE', 'GOLD']),
                name='catalog_chest_type_valid',
            ),
        ]

    @property
    def icon_static_path(self):
        return f'avalon/icons/chest_{self.chest_type.lower()}.png'

    def __str__(self):
        return f'{self.get_chest_type_display()} ({self.get_size_display()}) × {self.count}'


class MapDungeon(MapFeature):
    class DungeonType(models.TextChoices):
        SOLO = 'DUNGEON_SOLO', 'Solo'
        GROUP = 'DUNGEON_GROUP', 'Grupo'

    road_map = models.ForeignKey(RoadMap, on_delete=models.CASCADE, related_name='dungeons')
    dungeon_type = models.CharField('dungeon', max_length=20, choices=DungeonType.choices)

    class Meta(MapFeature.Meta):
        abstract = False
        ordering = ['dungeon_type', 'size']
        verbose_name = 'dungeon'
        verbose_name_plural = 'dungeons'
        constraints = MapFeature.Meta.constraints + [
            models.UniqueConstraint(
                fields=['road_map', 'dungeon_type', 'size'], name='catalog_dungeon_unique',
            ),
            models.CheckConstraint(
                condition=models.Q(dungeon_type__in=['DUNGEON_SOLO', 'DUNGEON_GROUP']),
                name='catalog_dungeon_type_valid',
            ),
        ]

    @property
    def icon_static_path(self):
        return f'avalon/icons/{self.dungeon_type.lower()}.png'

    def __str__(self):
        return f'{self.get_dungeon_type_display()} ({self.get_size_display()}) × {self.count}'
