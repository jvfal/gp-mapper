import copy

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from catalog.models import RoadMap
from .models import Board, BoardAccess, GuildRole
from .roles import GUILD_MASTER_GROUP


@override_settings(DISCORD_GUILD_ID='', DISCORD_MEMBER_ROLE_ID='', STORAGES={
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
        self.assertEqual({node['name'] for node in listed['preview']['nodes']}, {'One', 'Two'})
        self.assertEqual(listed['preview']['edges'][0]['expiresAt'], edge['expiresAt'])
        self.assertEqual({listed['preview']['edges'][0]['source'], listed['preview']['edges'][0]['target']},
                         {node['id'] for node in listed['preview']['nodes']})

    def test_stale_revision_never_overwrites_saved_board(self):
        self.assertEqual(self.put().status_code, 200)
        changed = copy.deepcopy(self.state)
        changed['nodes'] = []
        changed['edges'] = []
        self.assertEqual(self.put(changed).status_code, 409)
        self.assertEqual(self.board.nodes.count(), 2)

    def test_home_is_saved_and_realtime_moves_preserve_it(self):
        from uuid import uuid4
        from .realtime import mutate_board
        RoadMap.objects.filter(pk=1).update(is_hideout=True)
        self.assertEqual(self.put().status_code, 200)
        marked = mutate_board(self.board.pk, self.client.session.session_key, str(uuid4()),
                              [{'type': 'node.home', 'mapId': 1, 'isHome': True}])
        self.assertTrue(next(n for n in marked['state']['nodes'] if n['mapId'] == 1)['isHome'])
        moved = mutate_board(self.board.pk, self.client.session.session_key, str(uuid4()),
                             [{'type': 'node.move', 'mapId': 1, 'position': {'x': 80, 'y': 90}}])
        node = next(n for n in moved['state']['nodes'] if n['mapId'] == 1)
        self.assertTrue(node['isHome'])
        self.assertEqual(node['position'], {'x': 80, 'y': 90})
        self.assertTrue(self.client.get(self.url).json()['board']['state']['nodes'][0]['isHome'])
        with self.assertRaisesMessage(ValueError, 'invalid_home'):
            mutate_board(self.board.pk, self.client.session.session_key, str(uuid4()),
                         [{'type': 'node.home', 'mapId': 2, 'isHome': True}])
        mutate_board(self.board.pk, self.client.session.session_key, str(uuid4()),
                     [{'type': 'node.home', 'mapId': 1, 'isHome': False}])
        self.assertFalse(self.board.nodes.get(road_map_id=1).is_home)

    def test_owner_can_delete_saved_graph_without_deleting_catalog(self):
        from unittest.mock import patch
        self.put()
        self.assertTrue(self.client.get(self.url).json()['board']['canDelete'])
        with patch('mapper.boards.publish_board') as publish:
            response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 200)
        publish.assert_called_once_with(self.board.pk, event_type='board.deleted')
        self.assertFalse(Board.objects.filter(pk=self.board.pk).exists())
        self.assertEqual(RoadMap.objects.count(), 2)
        self.assertFalse(self.board.nodes.exists())

    def test_editor_needs_delete_role_and_existing_view_access(self):
        self.board.scope = 'guild'
        self.board.guild_can_edit = True
        self.board.save(update_fields=['scope', 'guild_can_edit'])
        self.client.force_login(self.other)
        self.assertFalse(self.client.get(self.url).json()['board']['canDelete'])
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        role = GuildRole.objects.create(name='Map cleanup', can_delete_guild_maps=True)
        self.other.guild_roles.add(role)
        self.assertTrue(self.client.get(self.url).json()['board']['canDelete'])
        self.board.guild_can_view = self.board.guild_can_edit = False
        self.board.save(update_fields=['guild_can_view', 'guild_can_edit'])
        self.assertEqual(self.client.delete(self.url).status_code, 404)
        BoardAccess.objects.create(board=self.board, user=self.other, can_view=True)
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        private = Board.objects.create(owner=self.owner, name='Personal')
        self.assertEqual(self.client.delete(reverse('board-detail', args=[private.pk])).status_code, 404)

    def test_guild_master_can_delete_guild_boards_but_not_other_personal_boards(self):
        private = Board.objects.create(owner=self.owner, name='Personal')
        self.other.groups.add(Group.objects.get(name=GUILD_MASTER_GROUP))
        self.client.force_login(self.other)
        self.board.scope = 'guild'
        self.board.guild_can_view = False
        self.board.save(update_fields=['scope', 'guild_can_view'])
        self.assertEqual(self.client.delete(self.url).status_code, 200)
        self.assertEqual(self.client.delete(reverse('board-detail', args=[private.pk])).status_code, 404)

    def test_attribution_is_server_owned_and_preserved_when_another_user_edits(self):
        self.put()
        original_node = self.board.nodes.get(road_map_id=1)
        original_edge = self.board.connections.get()
        self.board.scope = 'guild'
        self.board.guild_can_edit = True
        self.board.save(update_fields=['scope', 'guild_can_edit'])
        self.client.force_login(self.other)
        changed = copy.deepcopy(self.state)
        changed['nodes'][0]['position']['x'] = 50
        changed['nodes'][0]['audit'] = {'createdBy': 'fake', 'createdAt': '2000-01-01'}
        changed['edges'][0]['expiresAt'] += 60_000
        self.assertEqual(self.put(changed, revision=1).status_code, 200)
        node = self.board.nodes.get(road_map_id=1)
        edge = self.board.connections.get()
        self.assertEqual((node.created_by, edge.created_by), (self.owner, self.owner))
        self.assertEqual((node.created_at, edge.created_at), (original_node.created_at, original_edge.created_at))
        self.assertEqual((node.updated_by, edge.updated_by), (self.other, self.other))
        self.assertEqual(self.board.nodes.get(road_map_id=2).updated_by, self.owner)
        state = self.client.get(self.url).json()['board']['state']
        self.assertEqual(state['edges'][0]['audit']['createdBy'], 'owner')
        self.assertEqual(state['edges'][0]['audit']['updatedBy'], 'other')
        before = edge.updated_at
        self.assertEqual(self.put(changed, revision=2).status_code, 200)
        self.assertEqual(self.board.connections.get().updated_at, before)

    def test_realtime_updates_attribution_without_changing_creator(self):
        from uuid import uuid4
        from .realtime import mutate_board
        self.put()
        self.board.scope = 'guild'
        self.board.guild_can_edit = True
        self.board.save(update_fields=['scope', 'guild_can_edit'])
        self.client.force_login(self.other)
        key = uuid4()
        operations = [{'type': 'node.move', 'mapId': 1, 'position': {'x': 77, 'y': 55}}]
        result = mutate_board(self.board.pk, self.client.session.session_key, key, operations)
        audit = next(node for node in result['state']['nodes'] if node['mapId'] == 1)['audit']
        self.assertEqual((audit['createdBy'], audit['updatedBy']), ('owner', 'other'))
        retry = mutate_board(self.board.pk, self.client.session.session_key, key, operations)
        self.assertEqual(retry['state']['nodes'], result['state']['nodes'])

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

    def test_guild_master_manages_restricted_guild_maps_but_not_other_users_private_maps(self):
        from .realtime import read_board

        self.board.scope = Board.Scope.GUILD
        self.board.guild_can_view = self.board.guild_can_edit = False
        self.board.save()
        private = Board.objects.create(owner=self.owner, name='Personal')
        group = Group.objects.get(name=GUILD_MASTER_GROUP)
        self.other.groups.add(group)
        self.client.force_login(self.other)
        listing = self.client.get(reverse('board-list')).json()
        self.assertTrue(listing['user']['isGuildMaster'])
        self.assertFalse(listing['user']['isStaff'])
        self.assertEqual([row['id'] for row in listing['boards']], [str(self.board.pk)])
        expected = {'canView': True, 'canEdit': True, 'canManage': True}
        self.assertEqual(listing['boards'][0]['permissions'], expected)
        self.assertFalse(listing['boards'][0]['isOwner'])
        self.assertEqual(self.client.get(reverse('board-detail', args=[private.pk])).status_code, 404)
        self.assertEqual(self.put().status_code, 200)
        self.assertEqual(self.client.patch(self.url, {'name': 'GM renamed'}, content_type='application/json').status_code, 200)
        access_url = reverse('board-access', args=[self.board.pk])
        self.assertEqual(self.client.get(access_url).status_code, 200)
        self.assertEqual(self.client.put(access_url, {
            'scope': 'guild', 'guildCanView': False, 'guildCanEdit': False, 'users': [],
        }, content_type='application/json').status_code, 200)
        self.assertEqual(read_board(self.board.pk, self.client.session.session_key)['permissions'], expected)
        self.board.refresh_from_db()
        self.assertEqual(self.board.owner_id, self.owner.pk)

    def test_removing_guild_master_takes_effect_on_existing_session(self):
        from .realtime import AccessDenied, read_board

        self.board.scope = Board.Scope.GUILD
        self.board.guild_can_view = False
        self.board.save()
        group = Group.objects.get(name=GUILD_MASTER_GROUP)
        self.other.groups.add(group)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.other.groups.remove(group)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertFalse(self.client.get(reverse('board-list')).json()['user']['isGuildMaster'])
        with self.assertRaises(AccessDenied):
            read_board(self.board.pk, self.client.session.session_key)

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
        self.owner.guild_roles.create(name='Map creators', can_create_guild_maps=True)
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
