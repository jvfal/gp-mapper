from django.db import migrations, models


KINDS = [
    ('WOOD', 'Madeira'), ('STONE', 'Pedra'), ('ORE', 'Minério'),
    ('HIDE', 'Couro'), ('FIBER', 'Fibra'), ('GREEN', 'Baú verde'),
    ('BLUE', 'Baú azul'), ('GOLD', 'Baú dourado'),
    ('DUNGEON_SOLO', 'Dungeon solo'), ('DUNGEON_GROUP', 'Dungeon de grupo'),
]


def merge_features(apps, schema_editor):
    resource = apps.get_model('catalog', 'MapResource')
    database = schema_editor.connection.alias
    for model_name, category, type_field in [
        ('MapChest', 'CHEST', 'chest_type'),
        ('MapDungeon', 'DUNGEON', 'dungeon_type'),
    ]:
        source = apps.get_model('catalog', model_name)
        resource.objects.using(database).bulk_create([
            resource(
                road_map_id=row['road_map_id'], resource_type=category,
                kind=row[type_field], size=row['size'], count=row['count'],
            )
            for row in source.objects.using(database).values('road_map_id', type_field, 'size', 'count')
        ])


def split_features(apps, schema_editor):
    resource = apps.get_model('catalog', 'MapResource')
    database = schema_editor.connection.alias
    for model_name, category, type_field in [
        ('MapChest', 'CHEST', 'chest_type'),
        ('MapDungeon', 'DUNGEON', 'dungeon_type'),
    ]:
        target = apps.get_model('catalog', model_name)
        rows = resource.objects.using(database).filter(resource_type=category)
        target.objects.using(database).bulk_create([
            target(
                road_map_id=row['road_map_id'], **{type_field: row['kind']},
                size=row['size'], count=row['count'],
            )
            for row in rows.values('road_map_id', 'kind', 'size', 'count')
        ])
        rows.delete()


class Migration(migrations.Migration):
    dependencies = [('catalog', '0001_initial')]

    operations = [
        migrations.RemoveConstraint(model_name='mapresource', name='catalog_resource_unique'),
        migrations.RemoveConstraint(model_name='mapresource', name='catalog_resource_type_valid'),
        migrations.RenameField(model_name='mapresource', old_name='resource_type', new_name='kind'),
        migrations.AlterField(
            model_name='mapresource', name='kind',
            field=models.CharField('tipo', max_length=20, choices=KINDS),
        ),
        migrations.AddField(
            model_name='mapresource', name='resource_type',
            field=models.CharField(
                'categoria', max_length=8, default='RESOURCE',
                choices=[('RESOURCE', 'Recurso'), ('CHEST', 'Baú'), ('DUNGEON', 'Dungeon')],
            ),
        ),
        migrations.AlterModelOptions(
            name='mapresource',
            options={
                'abstract': False, 'ordering': ['resource_type', 'kind', 'size'],
                'verbose_name': 'recurso', 'verbose_name_plural': 'recursos',
            },
        ),
        migrations.AddConstraint(
            model_name='mapresource',
            constraint=models.UniqueConstraint(
                fields=['road_map', 'resource_type', 'kind', 'size'], name='catalog_resource_unique',
            ),
        ),
        migrations.AddConstraint(
            model_name='mapresource',
            constraint=models.CheckConstraint(
                condition=models.Q(resource_type__in=['RESOURCE', 'CHEST', 'DUNGEON']),
                name='catalog_resource_type_valid',
            ),
        ),
        migrations.AddConstraint(
            model_name='mapresource',
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(resource_type='RESOURCE', kind__in=['WOOD', 'STONE', 'ORE', 'HIDE', 'FIBER'])
                    | models.Q(resource_type='CHEST', kind__in=['GREEN', 'BLUE', 'GOLD'])
                    | models.Q(resource_type='DUNGEON', kind__in=['DUNGEON_SOLO', 'DUNGEON_GROUP'])
                ),
                name='catalog_resource_kind_valid',
            ),
        ),
        # Preserve existing chest/dungeon data before dropping the old tables.
        migrations.RunPython(merge_features, split_features),
        migrations.DeleteModel(name='MapChest'),
        migrations.DeleteModel(name='MapDungeon'),
    ]
