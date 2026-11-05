import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .broadcast import board_group
from .realtime import AccessDenied, mutate_board, read_board


class BoardConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.board_id = self.scope['url_route']['kwargs']['board_id']
        self.session_key = self.scope['session'].session_key
        self.group = board_group(self.board_id)
        try:
            await database_sync_to_async(read_board)(self.board_id, self.session_key)
            await self.channel_layer.group_add(self.group, self.channel_name)
            await self.channel_layer.group_add('module.mapper', self.channel_name)
            board = await database_sync_to_async(read_board)(self.board_id, self.session_key)
        except AccessDenied as error:
            await self.close(code=4404 if str(error) == 'board_deleted' else 4403)
            return
        await self.accept()
        await self.send_json({'type': 'snapshot', 'board': board})

    async def disconnect(self, code):
        if hasattr(self, 'group'):
            await self.channel_layer.group_discard(self.group, self.channel_name)
            await self.channel_layer.group_discard('module.mapper', self.channel_name)

    async def module_disabled(self, event):
        await self.send_json({'type': 'module.disabled'})
        await self.close(code=4403)

    async def board_deleted(self, event):
        await self.send_json({'type': 'board.deleted'})
        await self.close(code=4404)

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        if text_data is None or len(text_data) > 1_000_000:
            await self.close(code=1009)
            return
        try:
            await super().receive(text_data=text_data, **kwargs)
        except (ValueError, json.JSONDecodeError):
            await self.send_json({'type': 'error', 'error': 'invalid_message'})

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict):
            raise ValueError('invalid_message')
        if content.get('type') == 'sync':
            await self.channel_layer.group_add(self.group, self.channel_name)
            await self.board_changed({})
        elif content.get('type') == 'mutate':
            try:
                board = await database_sync_to_async(mutate_board)(
                    self.board_id, self.session_key, content.get('mutationId'), content.get('operations'))
                await self.send_json({'type': 'snapshot', 'board': board, 'ack': content.get('mutationId')})
            except AccessDenied as error:
                await self.deny(error)
            except ValueError as error:
                await self.send_json({'type': 'error', 'error': str(error), 'mutationId': content.get('mutationId')})
        else:
            raise ValueError('invalid_message')

    async def board_changed(self, event):
        try:
            board = await database_sync_to_async(read_board)(self.board_id, self.session_key)
            await self.send_json({'type': 'snapshot', 'board': board})
        except AccessDenied as error:
            await self.deny(error)

    async def deny(self, error=None):
        if str(error) == 'board_deleted':
            await self.board_deleted({})
            return
        await self.send_json({'type': 'denied'})
        await self.close(code=4403)
