from copy import deepcopy
from io import StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse

from .models import MapChest, MapDungeon, MapResource, RoadMap


class CatalogTests(TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'maps.json'
        self.row = {
            'id': 1, 'name': 'Cases-Ugumlos', 'tier': 6, 'image': 'Cases-Ugumlos_T_6.png',
            'resources': [
                {'type': 'STONE', 'size': 'small', 'count': 1},
                {'type': 'STONE', 'size': 'large', 'count': 1},
            ],
            'chests': [{'type': 'BLUE', 'size': 'large', 'count': 1}],
            'dungeons': [{'type': 'DUNGEON_SOLO', 'size': 'small', 'count': 1}],
        }

    def import_rows(self, rows, **options):
        self.path.write_text(json.dumps({'maps': rows}), encoding='utf-8')
        call_command('import_maps', str(self.path), stdout=StringIO(), **options)

    def test_import_and_reimport_preserve_identifiers_and_image_paths(self):
        self.import_rows([self.row])
        roadmap = RoadMap.objects.get(pk=1)
        resource_ids = list(roadmap.resources.values_list('pk', flat=True))
        self.import_rows([self.row])
        self.assertEqual(RoadMap.objects.count(), 1)
        self.assertEqual(list(roadmap.resources.values_list('pk', flat=True)), resource_ids)
        self.assertEqual(roadmap.resources.count(), 2)
        self.assertEqual(roadmap.image_static_path, 'avalon/maps/Cases-Ugumlos_T_6.png')
        self.assertEqual(roadmap.resources.first().icon_static_path,
                         'avalon/icons/resource_stone.png')
        self.assertEqual(roadmap.chests.get().icon_static_path,
                         'avalon/icons/chest_blue.png')
        self.assertEqual(roadmap.dungeons.get().icon_static_path,
                         'avalon/icons/dungeon_solo.png')

    def test_reimport_syncs_features_and_preserves_maps_not_in_file(self):
        absent = deepcopy(self.row)
        absent.update(id=2, name='Another-Map')
        self.import_rows([self.row, absent])
        resource_id = MapResource.objects.get(road_map_id=1, size='small').pk
        self.row['resources'] = [{'type': 'STONE', 'size': 'small', 'count': 3}]
        self.row['chests'] = []
        self.import_rows([self.row])
        self.assertEqual(RoadMap.objects.count(), 2)
        resource = MapResource.objects.get(road_map_id=1)
        self.assertEqual((resource.pk, resource.count), (resource_id, 3))
        self.assertFalse(MapChest.objects.filter(road_map_id=1).exists())
        self.assertEqual(MapDungeon.objects.filter(road_map_id=1).count(), 1)
        self.assertEqual(MapResource.objects.filter(road_map_id=2).count(), 2)

    def test_invalid_catalog_does_not_partially_import(self):
        invalid = deepcopy(self.row)
        invalid.update(id=2, name='Invalid-Map')
        for field, value in [('type', 'INVALID'), ('size', 'huge'), ('count', 0), ('count', True)]:
            with self.subTest(field=field, value=value):
                invalid['resources'] = [{'type': 'STONE', 'size': 'small', 'count': 1, field: value}]
                with self.assertRaises(CommandError):
                    self.import_rows([self.row, invalid])
                self.assertFalse(RoadMap.objects.exists())

    def test_duplicate_maps_and_features_are_rejected(self):
        with self.assertRaises(CommandError):
            self.import_rows([self.row, self.row])
        self.row['resources'].append(deepcopy(self.row['resources'][0]))
        with self.assertRaises(CommandError):
            self.import_rows([self.row])
        self.assertFalse(RoadMap.objects.exists())

    def test_database_conflict_rolls_back_previous_updates(self):
        self.import_rows([self.row])
        RoadMap.objects.create(pk=2, name='Already-Exists', tier=4)
        self.row['tier'] = 8
        conflicting = deepcopy(self.row)
        conflicting.update(id=3, name='Already-Exists')
        with self.assertRaises(CommandError):
            self.import_rows([self.row, conflicting])
        self.assertEqual(RoadMap.objects.get(pk=1).tier, 6)

    def test_dry_run_leaves_database_untouched(self):
        self.import_rows([self.row], dry_run=True)
        self.assertFalse(RoadMap.objects.exists())

    def test_complete_catalog_updates_existing_board_maps_and_can_be_reimported(self):
        from mapper.models import Board, BoardNode

        self.import_rows([self.row])
        retired = RoadMap.objects.create(pk=10000, name='Retired-Map', tier=4, image='old.png')
        user = get_user_model().objects.create_user(username='catalog-owner')
        board = Board.objects.create(owner=user, name='Existing exploration')
        node = BoardNode.objects.create(board=board, road_map_id=1, x=10, y=20)
        old_node = BoardNode.objects.create(board=board, road_map=retired, x=30, y=40)
        catalog_path = Path(__file__).resolve().parent.parent / 'maps.json'
        call_command('import_maps', str(catalog_path), stdout=StringIO())
        counts = (MapResource.objects.count(), MapChest.objects.count(), MapDungeon.objects.count())
        call_command('import_maps', str(catalog_path), stdout=StringIO())
        self.assertEqual(counts, (
            MapResource.objects.count(), MapChest.objects.count(), MapDungeon.objects.count(),
        ))
        self.assertEqual(RoadMap.objects.filter(is_active=True).count(), 400)
        self.assertEqual(RoadMap.objects.get(pk=1).name, self.row['name'])
        node.refresh_from_db()
        old_node.refresh_from_db()
        self.assertEqual((node.road_map_id, node.x, node.y), (1, 10, 20))
        self.assertEqual(old_node.road_map_id, retired.pk)
        retired.refresh_from_db()
        self.assertFalse(retired.is_active)
        self.assertEqual(retired.image, '')
        opavun = RoadMap.objects.get(name='Fones-Opavun')
        self.assertEqual(set(opavun.chests.values_list('chest_type', 'size', 'count')), {
            ('GREEN', 'small', 2), ('GOLD', 'small', 1), ('GOLD', 'large', 2),
        })
        self.assertEqual(list(opavun.resources.values_list('resource_type', 'size', 'count')), [
            ('WOOD', 'unknown', 1),
        ])
        self.assertEqual(opavun.dungeons.get().dungeon_type, 'DUNGEON')
        self.assertFalse(RoadMap.objects.get(name='Cetitos-Avixnum').chests.filter(chest_type='BLUE').exists())

    def test_database_enforces_feature_constraints(self):
        roadmap = RoadMap.objects.create(pk=1, name='Test-Map', tier=6)
        for model, field, kind in [
            (MapResource, 'resource_type', 'ORE'),
            (MapChest, 'chest_type', 'GREEN'),
            (MapDungeon, 'dungeon_type', 'DUNGEON_GROUP'),
        ]:
            valid = {
                'road_map': roadmap, field: kind, 'size': 'small', 'count': 1,
            }
            for change in ({'count': 0}, {'size': 'huge'}, {field: 'INVALID'}):
                with self.subTest(model=model.__name__, change=change):
                    with self.assertRaises(IntegrityError), transaction.atomic():
                        model.objects.create(**(valid | change))
            model.objects.create(**valid)
            with self.assertRaises(IntegrityError), transaction.atomic():
                model.objects.create(**valid)
            model.objects.create(**(valid | {'size': 'large'}))

    def test_types_from_other_models_are_rejected(self):
        roadmap = RoadMap.objects.create(pk=1, name='Test-Map', tier=6)
        for model, field, kind in [
            (MapResource, 'resource_type', 'BLUE'),
            (MapChest, 'chest_type', 'ORE'),
            (MapDungeon, 'dungeon_type', 'GREEN'),
        ]:
            with self.subTest(model=model.__name__, kind=kind):
                resource = model(road_map=roadmap, **{field: kind}, size='small', count=1)
                with self.assertRaises(ValidationError):
                    resource.full_clean()
                with self.assertRaises(IntegrityError), transaction.atomic():
                    resource.save()

    def test_import_rejects_kind_in_wrong_json_collection(self):
        self.row['chests'][0]['type'] = 'ORE'
        with self.assertRaises(CommandError):
            self.import_rows([self.row], dry_run=True)
        self.assertFalse(RoadMap.objects.exists())

    @override_settings(STORAGES={
        'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
        'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
    })
    def test_admin_hides_unverified_map_images_and_shows_normalized_inlines(self):
        self.import_rows([self.row])
        user = get_user_model().objects.create_superuser(username='catalog-admin', password=None)
        self.client.force_login(user)
        response = self.client.get(reverse('admin:catalog_roadmap_change', args=[1]))
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, 'avalon/maps/')
        self.assertContains(response, 'name="resources-TOTAL_FORMS"')
        self.assertContains(response, 'name="chests-TOTAL_FORMS"')
        self.assertContains(response, 'name="dungeons-TOTAL_FORMS"')


class ResourceMigrationTests(TransactionTestCase):
    def tearDown(self):
        MigrationExecutor(connection).migrate([('catalog', '0005_alter_roadmap_image')])
        super().tearDown()

    def test_existing_data_survives_merge_and_reverse_migration(self):
        executor = MigrationExecutor(connection)
        original = [('catalog', '0001_initial')]
        unified = [('catalog', '0002_unify_map_resources')]
        executor.migrate(original)
        old = executor.loader.project_state(original).apps
        old.get_model('catalog', 'RoadMap').objects.create(pk=100, name='Migration-Map', tier=6)
        resource = old.get_model('catalog', 'MapResource').objects.create(
            road_map_id=100, resource_type='ORE', size='small', count=2,
        )
        old.get_model('catalog', 'MapChest').objects.create(
            road_map_id=100, chest_type='BLUE', size='large', count=3,
        )
        old.get_model('catalog', 'MapDungeon').objects.create(
            road_map_id=100, dungeon_type='DUNGEON_GROUP', size='small', count=1,
        )
        executor = MigrationExecutor(connection)
        executor.migrate(unified)
        merged = executor.loader.project_state(unified).apps.get_model('catalog', 'MapResource')
        self.assertEqual(set(merged.objects.values_list('resource_type', 'kind', 'size', 'count')), {
            ('RESOURCE', 'ORE', 'small', 2), ('CHEST', 'BLUE', 'large', 3),
            ('DUNGEON', 'DUNGEON_GROUP', 'small', 1),
        })
        self.assertEqual(merged.objects.get(resource_type='RESOURCE').pk, resource.pk)
        executor = MigrationExecutor(connection)
        executor.migrate(original)
        restored = executor.loader.project_state(original).apps
        self.assertEqual(restored.get_model('catalog', 'MapResource').objects.get().resource_type, 'ORE')
        self.assertEqual(restored.get_model('catalog', 'MapChest').objects.get().count, 3)
        self.assertEqual(restored.get_model('catalog', 'MapDungeon').objects.get().dungeon_type, 'DUNGEON_GROUP')

    def test_unified_data_survives_separation_and_reverse_migration(self):
        unified = [('catalog', '0002_unify_map_resources')]
        separated = [('catalog', '0003_separate_map_features')]
        executor = MigrationExecutor(connection)
        executor.migrate(unified)
        old = executor.loader.project_state(unified).apps
        old.get_model('catalog', 'RoadMap').objects.create(pk=100, name='Split-Map', tier=6)
        unified_resource = old.get_model('catalog', 'MapResource')
        expected = {
            ('RESOURCE', 'ORE', 'small', 4), ('CHEST', 'BLUE', 'large', 2),
            ('DUNGEON', 'DUNGEON_SOLO', 'small', 3),
        }
        for category, kind, size, count in expected:
            unified_resource.objects.create(
                road_map_id=100, resource_type=category, kind=kind, size=size, count=count,
            )
        original_resource_pk = unified_resource.objects.get(resource_type='RESOURCE').pk
        executor = MigrationExecutor(connection)
        executor.migrate(separated)
        new = executor.loader.project_state(separated).apps
        self.assertEqual(new.get_model('catalog', 'MapResource').objects.get().count, 4)
        self.assertEqual(new.get_model('catalog', 'MapResource').objects.get().pk, original_resource_pk)
        self.assertEqual(new.get_model('catalog', 'MapChest').objects.get().chest_type, 'BLUE')
        self.assertEqual(new.get_model('catalog', 'MapDungeon').objects.get().count, 3)
        executor = MigrationExecutor(connection)
        executor.migrate(unified)
        restored = executor.loader.project_state(unified).apps.get_model('catalog', 'MapResource')
        self.assertEqual(set(restored.objects.values_list('resource_type', 'kind', 'size', 'count')), expected)
