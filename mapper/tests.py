from django.test import TestCase, override_settings
from django.urls import reverse

from catalog.models import MapChest, MapDungeon, MapResource, RoadMap


@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class MapperTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for index, name in [(1, 'Cases-Ugumlos'), (2, 'Casitos-Alieam')]:
            roadmap = RoadMap.objects.create(id=index, name=name, tier=6, image='Cases-Ugumlos_T_6.png')
            MapResource.objects.create(road_map=roadmap, resource_type='ORE', size='small', count=2)
            MapChest.objects.create(road_map=roadmap, chest_type='BLUE', size='large', count=1)
            MapDungeon.objects.create(road_map=roadmap, dungeon_type='DUNGEON_SOLO', size='small', count=1)

    def test_catalog_uses_four_queries_and_serializes_all_feature_types(self):
        with self.assertNumQueries(4):
            response = self.client.get(reverse('map-catalog'))
        self.assertEqual(response.status_code, 200)
        maps = response.json()['maps']
        self.assertEqual(len(maps), 2)
        self.assertEqual(maps[0]['resources'][0]['count'], 2)
        self.assertEqual(maps[0]['resources'][0]['icon_url'], '/static/avalon/icons/resource_ore.png')
        self.assertEqual(maps[0]['chests'][0]['size_label'], 'Grande')
        self.assertEqual(maps[0]['dungeons'][0]['type'], 'DUNGEON_SOLO')
        self.assertEqual(maps[0]['image_url'], '/static/avalon/maps/Cases-Ugumlos_T_6.png')

    def test_mapper_page_loads_compiled_assets_and_catalog_endpoint(self):
        response = self.client.get(reverse('mapper'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '/static/mapper/mapper.js')
        self.assertContains(response, '/static/mapper/mapper.css')
        self.assertContains(response, 'data-catalog-url="/api/catalog/maps/"')

    def test_catalog_endpoint_is_read_only(self):
        self.assertEqual(self.client.post(reverse('map-catalog')).status_code, 405)
