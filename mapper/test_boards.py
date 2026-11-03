import copy

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from catalog.models import RoadMap
from .models import Board, BoardAccess


@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class BoardTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user(username='owner')
        cls.other = get_user_model().objects.create_user(username='other')
        RoadMap.objects.bulk_create([RoadMap(id=1, name='One', tier=4), RoadMap(id=2, name='Two', tier=6)])

    def setUp(self):
        self.client.force_login(self.owner)
        self.board = Board.objects.create(owner=self.owner, name='Expedition')
        self.url = reverse('board-detail', args=[self.board.pk])
        self.state = {
            'version': 1,
            'nodes': [{'id': 'map-1', 'mapId': 1, 'position': {'x': 10, 'y': 20}},
                      {'id': 'map-2', 'mapId': 2, 'position': {'x': 200, 'y': -40}}],
            'edges': [{'id': 'edge-1', 'source': 'map-2', 'target': 'map-1',
                       'sourceHandle': 'left', 'targetHandle': 'right', 'expiresAt': 1_900_000_000_000}],
            'viewport': {'x': 30, 'y': -5, 'zoom': .8}, 'canvasWidth': 1200,
        }

    def put(self, state=None, revision=0):
        return self.client.put(self.url, {'revision': revision, 'state': state or self.state}, content_type='application/json')

    def test_session_is_required_and_other_users_cannot_access_board(self):
        self.client.logout()
        self.assertIsNone(self.client.get(reverse('board-list')).json()['user'])
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.assertEqual(self.client.post(reverse('board-list'), {'name': 'Private'}, content_type='application/json').status_code, 401)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(reverse('board-list')).json()['boards'], [])
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.put().status_code, 404)
        self.assertEqual(self.client.patch(self.url, {'name': 'Stolen'}, content_type='application/json').status_code, 404)

    def test_roundtrip_preserves_layout_handles_expiration_and_counts(self):
        self.assertEqual(self.put().status_code, 200)
        saved = self.client.get(self.url).json()['board']
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(saved['state']['viewport'], self.state['viewport'])
        edge = saved['state']['edges'][0]
        self.assertEqual((edge['source'], edge['target'], edge['sourceHandle'], edge['targetHandle']),
                         ('map-1', 'map-2', 'right', 'left'))
        self.assertEqual(edge['expiresAt'], 1_900_000_000_000)
        listed = self.client.get(reverse('board-list')).json()['boards'][0]
        self.assertEqual((listed['nodeCount'], listed['connectionCount']), (2, 1))

    def test_stale_revision_never_overwrites_saved_board(self):
        self.assertEqual(self.put().status_code, 200)
        changed = copy.deepcopy(self.state)
        changed['nodes'] = []
        changed['edges'] = []
        self.assertEqual(self.put(changed).status_code, 409)
        self.assertEqual(self.board.nodes.count(), 2)

    def test_invalid_states_are_rejected_without_changes(self):
        self.put()
        for mutation in ['duplicate', 'unknown', 'nan', 'handle', 'cross_board', 'type']:
            invalid = copy.deepcopy(self.state)
            if mutation == 'duplicate':
                duplicate = {**invalid['edges'][0], 'id': 'another'}
                invalid['edges'].append(duplicate)
            elif mutation == 'unknown':
                invalid['nodes'][0]['mapId'] = 999
            elif mutation == 'nan':
                invalid['nodes'][0]['position']['x'] = float('nan')
            elif mutation == 'handle':
                invalid['edges'][0]['sourceHandle'] = 'invalid'
            elif mutation == 'cross_board':
                invalid['edges'][0]['target'] = 'map-999'
            else:
                invalid['nodes'][0]['mapId'] = True
            with self.subTest(mutation=mutation):
                self.assertEqual(self.put(invalid, revision=1).status_code, 400)
                self.assertEqual(self.board.nodes.count(), 2)
                self.board.refresh_from_db()
                self.assertEqual(self.board.revision, 1)

    def test_create_rename_and_independent_boards(self):
        response = self.client.post(reverse('board-list'), {'name': '  New map  '}, content_type='application/json')
        self.assertEqual(response.status_code, 201)
        imported = response.json()['board']
        self.assertEqual(imported['name'], 'New map')
        self.assertEqual(len(imported['state']['nodes']), 0)
        self.assertEqual(self.board.nodes.count(), 0)
        response = self.client.patch(self.url, {'name': 'Renamed'}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.board.refresh_from_db()
        self.assertEqual(self.board.name, 'Renamed')
        self.assertEqual(self.client.post(reverse('board-list'), {'name': ' '}, content_type='application/json').status_code, 400)

    def test_mutations_enforce_csrf(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.owner)
        url = reverse('board-list')
        self.assertEqual(client.post(url, {'name': 'No CSRF'}, content_type='application/json').status_code, 403)
        client.get(reverse('mapper'))
        token = client.cookies['csrftoken'].value
        self.assertEqual(client.post(url, {'name': 'With CSRF'}, content_type='application/json', HTTP_X_CSRFTOKEN=token).status_code, 201)

    def test_guild_view_and_edit_permissions_are_enforced(self):
        self.board.scope = Board.Scope.GUILD
        self.board.save()
        self.client.force_login(self.other)
        listed = self.client.get(reverse('board-list')).json()['boards']
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]['permissions'], {'canView': True, 'canEdit': False, 'canManage': False})
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.put().status_code, 403)
        BoardAccess.objects.create(board=self.board, user=self.other, can_view=True, can_edit=True)
        self.assertEqual(self.put().status_code, 200)
        self.assertEqual(self.client.patch(self.url, {'name': 'No'}, content_type='application/json').status_code, 403)
        access_url = reverse('board-access', args=[self.board.pk])
        self.assertEqual(self.client.get(access_url).status_code, 404)
        self.assertEqual(self.client.put(access_url, {}, content_type='application/json').status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_owner_can_select_members_and_revoke_access(self):
        access_url = reverse('board-access', args=[self.board.pk])
        settings = {'scope': 'guild', 'guildCanView': False, 'guildCanEdit': False,
                    'users': [{'id': self.other.pk, 'canView': True, 'canEdit': False}]}
        self.assertEqual(self.client.put(access_url, settings, content_type='application/json').status_code, 200)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.put().status_code, 403)
        self.client.force_login(self.owner)
        settings['users'] = []
        self.assertEqual(self.client.put(access_url, settings, content_type='application/json').status_code, 200)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.get(reverse('board-list')).json()['boards'], [])
        self.client.force_login(self.owner)
        settings.update(guildCanView=True, guildCanEdit=True)
        self.assertEqual(self.client.put(access_url, settings, content_type='application/json').status_code, 200)
        self.client.force_login(self.other)
        self.assertEqual(self.put().status_code, 200)
        self.client.force_login(self.owner)
        settings['guildCanView'] = False
        self.assertEqual(self.client.put(access_url, settings, content_type='application/json').status_code, 400)
        settings.update(scope='private', guildCanView=True)
        self.assertEqual(self.client.put(access_url, settings, content_type='application/json').status_code, 200)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 404)
