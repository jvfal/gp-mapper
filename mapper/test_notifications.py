from datetime import timedelta
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError

from django.contrib.auth import get_user_model
from django.test import TestCase, SimpleTestCase, override_settings
from django.utils import timezone

from catalog.models import RoadMap
from .discord_bot import BotError, discord_request, validate_channel
from .models import Board, BoardConnection, BoardNode, GuildModule, MapperModuleSettings, RouteNotification
from .notifications import bot_status, deliver, run_tick


@override_settings(DISCORD_BOT_TOKEN='fake-test-token', DISCORD_GUILD_ID='123', DISCORD_MEMBER_ROLE_ID='')
class NotificationTests(TestCase):
    def setUp(self):
        self.module = GuildModule.objects.get(code='mapper')
        self.config = MapperModuleSettings.objects.get(module=self.module)
        self.config.discord_channel_id = '456'
        self.config.save()
        user = get_user_model().objects.create_user(username='notification-owner')
        self.board = Board.objects.create(owner=user, name='Guild routes', scope='guild', guild_can_view=True)
        nodes = [BoardNode.objects.create(board=self.board, road_map=RoadMap.objects.create(pk=i, name=f'Road-{i}', tier=6)) for i in (1, 2)]
        self.edge = BoardConnection.objects.create(
            board=self.board, client_id='stable-edge', source=nodes[0], target=nodes[1],
            source_handle='right', target_handle='left', expires_at=timezone.now() + timedelta(minutes=10),
        )

    @patch('mapper.notifications.validate_channel', return_value=0)
    @patch('mapper.notifications.discord_request', return_value=({'id': 'message-id'}, 0))
    def test_warning_and_expiry_sent_once_even_if_connection_row_is_recreated(self, send, validate):
        now = timezone.now()
        expiry = now + timedelta(minutes=10)
        self.edge.expires_at = expiry
        self.edge.save()
        run_tick()
        old_pk = self.edge.pk
        self.edge.delete()
        self.edge.pk = None
        self.edge.save()
        self.assertNotEqual(old_pk, self.edge.pk)
        run_tick()
        self.assertEqual(send.call_count, 1)
        with patch('mapper.notifications.timezone.now', return_value=expiry + timedelta(seconds=1)):
            run_tick()
            run_tick()
        self.assertEqual(send.call_count, 2)
        self.assertEqual(RouteNotification.objects.filter(sent_at__isnull=False).count(), 2)
        payload = send.call_args.args[1]
        self.assertEqual(payload['allowed_mentions'], {'parse': []})
        self.assertTrue(payload['enforce_nonce'])

    @patch('mapper.notifications.validate_channel', return_value=0)
    @patch('mapper.notifications.discord_request', return_value=({'id': 'message-id'}, 0))
    def test_updated_and_deleted_timers_rechecked_before_delivery(self, send, validate):
        old_expiry = self.edge.expires_at
        self.edge.expires_at += timedelta(hours=2)
        self.edge.save()
        deliver(self.board.pk, self.edge.client_id, old_expiry)
        run_tick()
        send.assert_not_called()
        self.edge.expires_at = timezone.now() + timedelta(minutes=1)
        self.edge.save()
        run_tick()
        self.assertEqual(send.call_count, 1)
        self.edge.expires_at += timedelta(minutes=1)
        self.edge.save()
        run_tick()
        self.assertEqual(send.call_count, 2)
        self.edge.delete()
        deliver(self.board.pk, self.edge.client_id, self.edge.expires_at)
        self.assertEqual(send.call_count, 2)

    @patch('mapper.notifications.validate_channel', return_value=0)
    @patch('mapper.notifications.discord_request')
    def test_private_restricted_old_and_disabled_maps_do_not_notify(self, send, validate):
        for changes in ({'scope': 'private'}, {'scope': 'guild', 'guild_can_view': False}):
            Board.objects.filter(pk=self.board.pk).update(**changes)
            run_tick()
        Board.objects.filter(pk=self.board.pk).update(scope='guild', guild_can_view=True)
        BoardConnection.objects.filter(pk=self.edge.pk).update(expires_at=timezone.now() - timedelta(minutes=6))
        run_tick()
        self.module.enabled = False
        self.module.save()
        run_tick()
        send.assert_not_called()

    @patch('mapper.notifications.validate_channel', return_value=0)
    @patch('mapper.notifications.discord_request')
    def test_rate_limit_is_persisted_and_retry_uses_same_nonce(self, send, validate):
        send.side_effect = BotError('rate_limited', 75)
        run_tick()
        first_payload = send.call_args.args[1]
        run_tick()
        self.assertEqual(send.call_count, 1)
        self.config.refresh_from_db()
        self.assertEqual(bot_status(self.config), 'rate_limited')
        self.assertFalse(RouteNotification.objects.exclude(sent_at=None).exists())
        MapperModuleSettings.objects.filter(pk=self.config.pk).update(bot_retry_at=timezone.now() - timedelta(seconds=1))
        send.side_effect = None
        send.return_value = ({'id': 'success'}, 0)
        run_tick()
        self.assertEqual(send.call_args.args[1]['nonce'], first_payload['nonce'])
        self.assertEqual(RouteNotification.objects.get().attempts, 2)
        self.config.refresh_from_db()
        self.assertEqual(bot_status(self.config), 'ready')

    @override_settings(DISCORD_BOT_TOKEN='')
    @patch('mapper.notifications.validate_channel')
    def test_missing_token_never_calls_discord(self, validate):
        run_tick()
        validate.assert_not_called()
        self.assertEqual(bot_status(self.config), 'missing_token')


@override_settings(DISCORD_BOT_TOKEN='fake-test-token', DISCORD_GUILD_ID='123')
class DiscordClientTests(SimpleTestCase):
    @patch('mapper.discord_bot.urlopen')
    def test_auth_and_rate_limit_errors_are_safe_and_preserve_retry_after(self, open_url):
        open_url.side_effect = HTTPError('https://discord.com', 429, 'limited', {}, BytesIO(b'{"retry_after": 12.5}'))
        with self.assertRaises(BotError) as caught:
            discord_request('/channels/456/messages', {'content': 'hello'})
        self.assertEqual(caught.exception.code, 'rate_limited')
        self.assertEqual(caught.exception.retry_after, 12.5)
        open_url.side_effect = HTTPError('https://discord.com', 401, 'secret-response', {}, None)
        with self.assertRaises(BotError) as caught:
            discord_request('/channels/456')
        self.assertEqual(str(caught.exception), 'invalid_token')

    @patch('mapper.discord_bot.discord_request', return_value=({'guild_id': 'different', 'type': 0}, 0))
    def test_channel_must_belong_to_configured_guild(self, request):
        with self.assertRaises(BotError) as caught:
            validate_channel('456')
        self.assertEqual(caught.exception.code, 'wrong_guild')
