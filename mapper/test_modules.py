from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from catalog.models import RoadMap
from .models import Board, BoardNode, MapperModuleSettings
from .realtime import AccessDenied, read_board


@override_settings(
    DISCORD_GUILD_ID='', DISCORD_MEMBER_ROLE_ID='',
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}},
)
class ModuleTests(TestCase):
    def setUp(self):
        self.gm = get_user_model().objects.create_user(username='module-gm')
        self.gm.groups.add(Group.objects.get(name='Guild Master'))
        self.member = get_user_model().objects.create_user(username='module-member')
        self.manager = Client()
        self.manager.force_login(self.gm)
        self.client.force_login(self.member)
        self.payload = {
            'enabled': False,
            'settings': {'discordChannelId': '123456789012345678', 'warningMinutes': 20},
        }

    @patch('mapper.configuration.announce_disabled')
    def test_disabling_blocks_http_and_realtime_preserves_maps_and_leaves_settings_accessible(self, announce):
        roadmap = RoadMap.objects.create(pk=1, name='Preserved-Road', tier=6)
        board = Board.objects.create(owner=self.member, name='Preserved board')
        node = BoardNode.objects.create(board=board, road_map=roadmap, x=24, y=48)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.manager.put(reverse('configure-mapper'), self.payload, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        announce.assert_called_once()
        self.assertFalse(response.json()['module']['botAvailable'])
        self.assertEqual(self.client.get(reverse('board-list')).status_code, 403)
        self.assertEqual(self.client.post(reverse('board-list'), {'name': 'No'}, content_type='application/json').status_code, 403)
        self.assertEqual(self.client.get(reverse('map-catalog')).status_code, 403)
        self.assertEqual(self.client.get(reverse('board-detail', args=[board.pk])).status_code, 404)
        with self.assertRaises(AccessDenied):
            read_board(board.pk, self.client.session.session_key)
        session = self.client.get(reverse('current-session'))
        self.assertEqual(session.status_code, 200)
        self.assertFalse(session.json()['modules']['mapper'])
        self.assertTrue(session.json()['user']['canAccess'])
        self.assertEqual(self.manager.get(reverse('guild-settings')).status_code, 200)
        self.assertEqual(self.manager.get(reverse('guild-members')).status_code, 200)
        self.assertTrue(BoardNode.objects.filter(pk=node.pk, x=24, y=48).exists())
        self.payload['enabled'] = True
        self.assertEqual(self.manager.put(reverse('configure-mapper'), self.payload, content_type='application/json').status_code, 200)
        self.assertEqual(self.client.get(reverse('board-detail', args=[board.pk])).status_code, 200)
        self.assertEqual(MapperModuleSettings.objects.get().discord_channel_id, '123456789012345678')

    def test_only_managers_can_configure_modules_and_invalid_values_are_not_saved(self):
        self.assertEqual(self.client.get(reverse('guild-settings')).status_code, 403)
        self.assertEqual(self.client.put(reverse('configure-mapper'), self.payload, content_type='application/json').status_code, 403)
        for changes in ({'discordChannelId': 'not-an-id'}, {'warningMinutes': 0}, {'warningMinutes': 121}):
            with self.subTest(changes=changes):
                data = {**self.payload, 'settings': {**self.payload['settings'], **changes}}
                self.assertEqual(self.manager.put(reverse('configure-mapper'), data, content_type='application/json').status_code, 400)
        self.assertTrue(self.client.get(reverse('current-session')).json()['modules']['mapper'])

    def test_switch_saves_only_enabled_state_and_preserves_module_parameters(self):
        data = {**self.payload, 'enabled': True}
        self.manager.put(reverse('configure-mapper'), data, content_type='application/json')
        response = self.manager.patch(reverse('configure-mapper'), {'enabled': False}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['module']['enabled'])
        self.assertEqual(response.json()['module']['settings'], self.payload['settings'])
        self.assertEqual(self.client.patch(reverse('configure-mapper'), {'enabled': True}, content_type='application/json').status_code, 403)
