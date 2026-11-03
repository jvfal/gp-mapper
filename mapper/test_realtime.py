import asyncio
import json
from uuid import uuid4

from asgiref.sync import async_to_sync
from asgiref.testing import ApplicationCommunicator
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.test import Client, TransactionTestCase, override_settings

from catalog.models import RoadMap
from .models import Board, BoardAccess


@override_settings(CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}},
                   ALLOWED_HOSTS=['localhost', '127.0.0.1'])
class RealtimeTests(TransactionTestCase):
    def setUp(self):
        users = [get_user_model().objects.create_user(username=name) for name in ['owner', 'editor', 'viewer']]
        self.owner, self.editor, self.viewer = users
        self.clients = []
        self.sessions = []
        for user in users:
            client = Client()
            client.force_login(user)
            self.clients.append(client)
            self.sessions.append(client.session.session_key)
        self.board = Board.objects.create(owner=self.owner, name='Live', scope='guild')
        BoardAccess.objects.create(board=self.board, user=self.editor, can_view=True, can_edit=True)
        RoadMap.objects.bulk_create([RoadMap(id=1, name='One', tier=4), RoadMap(id=2, name='Two', tier=6)])

    async def connect(self, session=None, origin='http://localhost'):
        from config.asgi import application
        path = f'/ws/boards/{self.board.pk}/'
        headers = [(b'origin', origin.encode()), (b'host', b'localhost')]
        if session:
            headers.append((b'cookie', f'sessionid={session}'.encode()))
        communicator = ApplicationCommunicator(application, {
            'type': 'websocket', 'path': path, 'raw_path': path.encode(), 'query_string': b'',
            'headers': headers, 'subprotocols': [], 'scheme': 'ws',
        })
        await communicator.send_input({'type': 'websocket.connect'})
        return communicator

    async def message(self, connection, predicate=lambda value: True):
        for _ in range(30):
            event = await connection.receive_output(timeout=3)
            if event['type'] == 'websocket.send':
                data = json.loads(event['text'])
                if predicate(data):
                    return data
        self.fail('Expected WebSocket message was not received')

    async def send(self, connection, operations, mutation_id=None):
        key = mutation_id or str(uuid4())
        await connection.send_input({'type': 'websocket.receive', 'text': json.dumps({
            'type': 'mutate', 'mutationId': key, 'operations': operations,
        })})
        return key

    def test_concurrent_edits_retry_viewer_and_revocation(self):
        async def scenario():
            connections = [await self.connect(session) for session in self.sessions]
            try:
                for connection in connections:
                    self.assertEqual((await connection.receive_output())['type'], 'websocket.accept')
                    await self.message(connection)
                a, b, viewer = connections
                keys = await asyncio.gather(
                    self.send(a, [{'type': 'node.add', 'mapId': 1, 'position': {'x': 0, 'y': 0}}]),
                    self.send(b, [{'type': 'node.add', 'mapId': 2, 'position': {'x': 300, 'y': 0}}]),
                )
                await self.message(a, lambda data: data.get('ack') == keys[0])
                await self.message(b, lambda data: data.get('ack') == keys[1])
                merged = await self.message(viewer, lambda data: len(data.get('board', {}).get('state', {}).get('nodes', [])) == 2)
                self.assertEqual(merged['board']['revision'], 2)
                first_move = await self.send(a, [{'type': 'node.move', 'mapId': 1, 'position': {'x': 10, 'y': 0}}])
                await self.message(a, lambda data: data.get('ack') == first_move)
                second_move = await self.send(b, [{'type': 'node.move', 'mapId': 1, 'position': {'x': 20, 'y': 0}}])
                await self.message(b, lambda data: data.get('ack') == second_move)
                await self.send(a, [{'type': 'node.move', 'mapId': 1, 'position': {'x': 10, 'y': 0}}], first_move)
                retry = await self.message(a, lambda data: data.get('ack') == first_move)
                self.assertEqual(retry['board']['revision'], 4)
                self.assertEqual(next(node for node in retry['board']['state']['nodes'] if node['mapId'] == 1)['position']['x'], 20)
                deletion = await self.send(a, [{'type': 'node.remove', 'mapId': 1}])
                await self.message(a, lambda data: data.get('ack') == deletion)
                stale_move = await self.send(b, [{'type': 'node.move', 'mapId': 1, 'position': {'x': 999, 'y': 0}}])
                result = await self.message(b, lambda data: data.get('ack') == stale_move)
                self.assertEqual(len(result['board']['state']['nodes']), 1)
                await self.send(viewer, [{'type': 'node.remove', 'mapId': 2}])
                await self.message(viewer, lambda data: data.get('type') == 'denied')
                self.assertEqual((await viewer.receive_output())['type'], 'websocket.close')
                # Revoke the editor while its socket is still open.
                response = await database_sync_to_async(self.clients[0].put)(
                    f'/api/boards/{self.board.pk}/access/',
                    {'scope': 'guild', 'guildCanView': False, 'guildCanEdit': False, 'users': []},
                    content_type='application/json', HTTP_HOST='localhost')
                self.assertEqual(response.status_code, 200)
                await self.message(b, lambda data: data.get('type') == 'denied')
                self.assertEqual((await b.receive_output())['type'], 'websocket.close')
            finally:
                for connection in connections:
                    await connection.send_input({'type': 'websocket.disconnect', 'code': 1000})
                    await connection.wait()
        async_to_sync(scenario)()

    def test_socket_requires_session_and_trusted_origin(self):
        async def scenario():
            for session, origin in [(None, 'http://localhost'), (self.sessions[0], 'https://untrusted.invalid')]:
                connection = await self.connect(session, origin)
                self.assertEqual((await connection.receive_output())['type'], 'websocket.close')
                await connection.send_input({'type': 'websocket.disconnect', 'code': 1000})
                await connection.wait()
        async_to_sync(scenario)()
