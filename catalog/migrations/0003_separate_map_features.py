import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


def split_features(apps, schema_editor):
    resource = apps.get_model('catalog', 'MapResource')
    database = schema_editor.connection.alias
    for model_name, category, type_field in [
        ('MapChest', 'CHEST', 'chest_type'), ('MapDungeon', 'DUNGEON', 'dungeon_type'),
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


def merge_features(apps, schema_editor):
    resource = apps.get_model('catalog', 'MapResource')
    database = schema_editor.connection.alias
    for model_name, category, type_field in [
        ('MapChest', 'CHEST', 'chest_type'), ('MapDungeon', 'DUNGEON', 'dungeon_type'),
    ]:
        source = apps.get_model('catalog', model_name)
        resource.objects.using(database).bulk_create([
            resource(
                road_map_id=row['road_map_id'], resource_type=category,
                kind=row[type_field], size=row['size'], count=row['count'],
            )
            for row in source.objects.using(database).values('road_map_id', type_field, 'size', 'count')
        ])


class Migration(migrations.Migration):
    dependencies = [('catalog', '0002_unify_map_resources')]

    operations = [
        migrations.CreateModel(
            name='MapChest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('size', models.CharField('tamanho', choices=[('small', 'Pequeno'), ('large', 'Grande')], max_length=5)),
                ('count', models.PositiveSmallIntegerField('quantidade', validators=[django.core.validators.MinValueValidator(1)])),
                ('chest_type', models.CharField('baú', choices=[('GREEN', 'Verde'), ('BLUE', 'Azul'), ('GOLD', 'Dourado')], max_length=10)),
                ('road_map', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='chests', to='catalog.roadmap')),
            ],
            options={
                'abstract': False, 'ordering': ['chest_type', 'size'],
                'verbose_name': 'baú', 'verbose_name_plural': 'baús',
                'constraints': [
                    models.CheckConstraint(condition=models.Q(count__gt=0), name='catalog_mapchest_count_positive'),
                    models.CheckConstraint(condition=models.Q(size__in=['small', 'large']), name='catalog_mapchest_size_valid'),
                    models.UniqueConstraint(fields=['road_map', 'chest_type', 'size'], name='catalog_chest_unique'),
                    models.CheckConstraint(condition=models.Q(chest_type__in=['GREEN', 'BLUE', 'GOLD']), name='catalog_chest_type_valid'),
                ],
            },
        ),
        migrations.CreateModel(
            name='MapDungeon',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('size', models.CharField('tamanho', choices=[('small', 'Pequeno'), ('large', 'Grande')], max_length=5)),
                ('count', models.PositiveSmallIntegerField('quantidade', validators=[django.core.validators.MinValueValidator(1)])),
                ('dungeon_type', models.CharField('dungeon', choices=[('DUNGEON_SOLO', 'Solo'), ('DUNGEON_GROUP', 'Grupo')], max_length=20)),
                ('road_map', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dungeons', to='catalog.roadmap')),
            ],
            options={
                'abstract': False, 'ordering': ['dungeon_type', 'size'],
                'verbose_name': 'dungeon', 'verbose_name_plural': 'dungeons',
                'constraints': [
                    models.CheckConstraint(condition=models.Q(count__gt=0), name='catalog_mapdungeon_count_positive'),
                    models.CheckConstraint(condition=models.Q(size__in=['small', 'large']), name='catalog_mapdungeon_size_valid'),
                    models.UniqueConstraint(fields=['road_map', 'dungeon_type', 'size'], name='catalog_dungeon_unique'),
                    models.CheckConstraint(condition=models.Q(dungeon_type__in=['DUNGEON_SOLO', 'DUNGEON_GROUP']), name='catalog_dungeon_type_valid'),
                ],
            },
        ),
        # Move data before removing the category and restoring the resource type field.
        migrations.RunPython(split_features, merge_features),
        migrations.RemoveConstraint(model_name='mapresource', name='catalog_resource_unique'),
        migrations.RemoveConstraint(model_name='mapresource', name='catalog_resource_type_valid'),
        migrations.RemoveConstraint(model_name='mapresource', name='catalog_resource_kind_valid'),
        migrations.RemoveField(model_name='mapresource', name='resource_type'),
        migrations.RenameField(model_name='mapresource', old_name='kind', new_name='resource_type'),
        migrations.AlterField(
            model_name='mapresource', name='resource_type',
            field=models.CharField(
                'recurso', max_length=10,
                choices=[('WOOD', 'Madeira'), ('STONE', 'Pedra'), ('ORE', 'Minério'), ('HIDE', 'Couro'), ('FIBER', 'Fibra')],
            ),
        ),
        migrations.AlterModelOptions(
            name='mapresource',
            options={
                'abstract': False, 'ordering': ['resource_type', 'size'],
                'verbose_name': 'recurso', 'verbose_name_plural': 'recursos',
            },
        ),
        migrations.AddConstraint(
            model_name='mapresource',
            constraint=models.UniqueConstraint(
                fields=['road_map', 'resource_type', 'size'], name='catalog_resource_unique',
            ),
        ),
        migrations.AddConstraint(
            model_name='mapresource',
            constraint=models.CheckConstraint(
                condition=models.Q(resource_type__in=['WOOD', 'STONE', 'ORE', 'HIDE', 'FIBER']),
                name='catalog_resource_type_valid',
            ),
        ),
    ]
