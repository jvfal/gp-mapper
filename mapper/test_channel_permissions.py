from unittest.mock import patch
from io import BytesIO
from urllib.error import HTTPError

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .channel_permissions import (
    BOT_ACCESS, READ, WRITE, MANAGE_ROLES, SEND_MESSAGES, REQUIRED_PERMISSIONS, THREAD_PERMISSIONS,
    channel_overwrites, check_bot_permissions, configure_notification_channel,
)
from .discord_bot import BotError, discord_request
from .models import MapperModuleSettings


class ChannelOverwriteTests(SimpleTestCase):
    def test_only_members_read_and_only_our_bot_sends_even_with_existing_exceptions(self):
        unrelated = 1 << 15
        existing = [
            {'id': '100', 'type': 0, 'allow': str(READ | WRITE), 'deny': '0'},
            {'id': '200', 'type': 0, 'allow': str(WRITE), 'deny': '0'},
            {'id': '300', 'type': 0, 'allow': str(READ | WRITE | unrelated), 'deny': '0'},
            {'id': '400', 'type': 1, 'allow': str(READ | WRITE), 'deny': str(READ)},
        ]
        result = channel_overwrites(existing, '100', '200', '999')
        overwrites = {(item['type'], item['id']): item for item in result}

        def apply(bits, item):
            return (bits & ~int(item['deny'])) | int(item['allow'])

        def effective(roles, user):
            bits = apply(READ | WRITE, overwrites[0, '100'])
            allow = deny = 0
            for role in roles:
                item = overwrites.get((0, role))
                if item:
                    allow |= int(item['allow'])
                    deny |= int(item['deny'])
            bits = (bits & ~deny) | allow
            return apply(bits, overwrites[1, user]) if (1, user) in overwrites else bits

        self.assertEqual(effective(['200', '300'], '400') & READ, READ)
        self.assertEqual(effective(['200', '300'], '400') & WRITE, 0)
        self.assertEqual(effective(['300'], '400') & (READ | WRITE), 0)
        self.assertEqual(effective(['300'], '999') & BOT_ACCESS, BOT_ACCESS)
        self.assertTrue(int(overwrites[0, '300']['allow']) & unrelated)
        self.assertEqual(channel_overwrites(result, '100', '200', '999'), result)

    @override_settings(DISCORD_GUILD_ID='100', DISCORD_MEMBER_ROLE_ID='200')
    @patch('mapper.channel_permissions.discord_request')
    def test_setup_grants_bot_first_then_updates_only_the_selected_channel(self, request):
        channel = {'id': '500', 'guild_id': '100', 'type': 0, 'name': 'route-alerts', 'permission_overwrites': []}
        roles = [{'id': '200', 'managed': False}, {'id': '201', 'permissions': str(sum(REQUIRED_PERMISSIONS.values()) | sum(THREAD_PERMISSIONS.values()))}]
        request.side_effect = [(channel, 0), (roles, 0), ({'id': '999', 'bot': True}, 0), ({'roles': ['201']}, 0), (None, 0), (channel, 0)]
        self.assertEqual(configure_notification_channel('500'), 'route-alerts')
        self.assertEqual(request.call_args_list[4].args[0], '/channels/500/permissions/999')
        self.assertEqual(request.call_args_list[4].kwargs, {'method': 'PUT'})
        self.assertFalse(int(request.call_args_list[4].args[1]['allow']) & MANAGE_ROLES)
        self.assertEqual(request.call_args_list[5].args[0], '/channels/500')
        self.assertEqual(request.call_args_list[5].kwargs, {'method': 'PATCH'})

    @override_settings(DISCORD_GUILD_ID='100', DISCORD_MEMBER_ROLE_ID='200')
    @patch('mapper.channel_permissions.discord_request')
    def test_missing_thread_permissions_stops_before_writes_instead_of_self_granting_manage_roles(self, request):
        channel = {'id': '500', 'guild_id': '100', 'type': 0, 'name': 'alerts', 'permission_overwrites': []}
        roles = [{'id': '200', 'managed': False}, {'id': '201', 'permissions': str(sum(REQUIRED_PERMISSIONS.values()))}]
        request.side_effect = [(channel, 0), (roles, 0), ({'id': '999', 'bot': True}, 0), ({'roles': ['201']}, 0)]
        with self.assertRaises(BotError) as caught:
            configure_notification_channel('500')
        self.assertEqual(caught.exception.code, 'bot_thread_permissions_required')
        self.assertEqual(set(caught.exception.missing_permissions), set(THREAD_PERMISSIONS))
        self.assertEqual(request.call_count, 4)

    @override_settings(DISCORD_GUILD_ID='100')
    @patch('mapper.channel_permissions.notification_channel', return_value={
        'permission_overwrites': [{'id': '201', 'type': 0, 'allow': str(sum(THREAD_PERMISSIONS.values())), 'deny': '0'}],
    })
    def test_parent_thread_permissions_are_considered_without_granting_new_privileges(self, parent):
        roles = [{'id': '201', 'permissions': str(sum(REQUIRED_PERMISSIONS.values()))}]
        check_bot_permissions({'parent_id': '600'}, roles, {'roles': ['201']}, '999')
        parent.assert_called_once_with('600', category=True)

    @override_settings(DISCORD_GUILD_ID='100')
    def test_channel_restrictions_distinguished_from_permissions_not_granted_to_installed_bot(self):
        roles = [{'id': '201', 'permissions': str(sum(REQUIRED_PERMISSIONS.values()))}]
        channel = {'permission_overwrites': [{'id': '999', 'type': 1, 'allow': '0', 'deny': str(SEND_MESSAGES)}]}
        with self.assertRaises(BotError) as caught:
            check_bot_permissions(channel, roles, {'roles': ['201']}, '999')
        self.assertEqual(caught.exception.code, 'channel_permissions_blocked')
        self.assertEqual(caught.exception.missing_permissions, ('SEND_MESSAGES',))
        roles[0]['permissions'] = str(sum(REQUIRED_PERMISSIONS.values()) & ~MANAGE_ROLES)
        with self.assertRaises(BotError) as caught:
            check_bot_permissions({}, roles, {'roles': ['201']}, '999')
        self.assertEqual(caught.exception.code, 'bot_permissions_not_installed')
        self.assertEqual(caught.exception.missing_permissions, ('MANAGE_ROLES',))

    @override_settings(DISCORD_BOT_TOKEN='fake', DISCORD_CORPORATE_CA_COMPAT=False)
    @patch('mapper.discord_bot.urlopen')
    def test_forbidden_responses_keep_safe_discord_code_and_distinguish_non_discord_blocks(self, urlopen):
        urlopen.side_effect = HTTPError('https://discord.com', 403, 'forbidden', {}, BytesIO(b'{"code":50013,"message":"private response"}'))
        with self.assertRaises(BotError) as caught:
            discord_request('/channels/500')
        self.assertEqual(caught.exception.code, 'missing_permissions')
        self.assertEqual(caught.exception.discord_code, 50013)
        self.assertEqual(caught.exception.http_status, 403)
        self.assertNotIn('private response', str(caught.exception))
        urlopen.side_effect = HTTPError('https://discord.com', 403, 'forbidden', {}, BytesIO(b'<html>corporate filter</html>'))
        with self.assertRaises(BotError) as caught:
            discord_request('/channels/500')
        self.assertEqual(caught.exception.code, 'discord_forbidden')

    @override_settings(DISCORD_GUILD_ID='100', DISCORD_MEMBER_ROLE_ID='200')
    @patch('mapper.channel_permissions.discord_request')
    def test_failed_write_retains_exact_operation_for_support(self, request):
        channel = {'id': '500', 'guild_id': '100', 'type': 0, 'name': 'alerts', 'permission_overwrites': []}
        roles = [{'id': '200', 'permissions': str(sum(REQUIRED_PERMISSIONS.values()) | sum(THREAD_PERMISSIONS.values()))}]
        request.side_effect = [(channel, 0), (roles, 0), ({'id': '999', 'bot': True}, 0), ({'roles': ['200']}, 0), BotError('missing_permissions', http_status=403, discord_code=50013)]
        with self.assertRaises(BotError) as caught:
            configure_notification_channel('500')
        self.assertEqual(caught.exception.stage, 'grant_bot_access')
        self.assertEqual(caught.exception.discord_code, 50013)

    @override_settings(DISCORD_GUILD_ID='100', DISCORD_MEMBER_ROLE_ID='200')
    @patch('mapper.channel_permissions.discord_request', return_value=({'guild_id': 'different', 'type': 0}, 0))
    def test_foreign_channel_is_never_modified(self, request):
        with self.assertRaises(BotError) as caught:
            configure_notification_channel('500')
        self.assertEqual(caught.exception.code, 'wrong_guild')
        self.assertEqual(request.call_count, 1)

    @override_settings(DISCORD_BOT_TOKEN='fake', DISCORD_CORPORATE_CA_COMPAT=False)
    @patch('mapper.discord_bot.urlopen')
    def test_discord_put_accepts_empty_204_response(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        response.status = 204
        response.headers = {}
        self.assertEqual(discord_request('/channels/500/permissions/999', {'allow': '1'}, method='PUT'), (None, 0))
        self.assertEqual(urlopen.call_args.args[0].get_method(), 'PUT')


@override_settings(DISCORD_GUILD_ID='100', DISCORD_MEMBER_ROLE_ID='200', DISCORD_BOT_TOKEN='fake')
class ChannelSetupEndpointTests(TestCase):
    def setUp(self):
        self.gm = get_user_model().objects.create_user(username='channel-gm')
        self.gm.groups.add(Group.objects.get(name='Guild Master'))
        self.client.force_login(self.gm)
        self.config = MapperModuleSettings.objects.get(module_id='mapper')
        self.config.discord_channel_id = '500'
        self.config.save()
        self.url = reverse('prepare-discord-channel')
        self.payload = {'confirmed': True, 'channelId': '500'}

    @patch('mapper.configuration.configure_notification_channel', return_value='route-alerts')
    @patch('mapper.configuration.notification_channel', return_value={'name': 'route-alerts'})
    def test_only_explicit_manager_confirmation_for_saved_channel_can_modify_discord(self, lookup, configure):
        metadata = self.client.get(self.url)
        self.assertEqual(metadata.status_code, 200)
        self.assertEqual(metadata.json()['channelName'], 'route-alerts')
        self.assertFalse(metadata.json()['configured'])
        configure.assert_not_called()
        self.assertEqual(self.client.post(self.url, {'channelId': '500'}, content_type='application/json').status_code, 400)
        self.assertEqual(self.client.post(self.url, {**self.payload, 'channelId': '600'}, content_type='application/json').status_code, 409)
        configure.assert_not_called()
        response = self.client.post(self.url, self.payload, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['channelName'], 'route-alerts')
        configure.assert_called_once_with('500')
        persisted = self.client.get(reverse('guild-settings')).json()['modules'][0]['discordChannel']
        self.assertEqual(persisted, {'name': 'route-alerts', 'configured': True})
        self.client.force_login(get_user_model().objects.create_user(username='ordinary-member'))
        self.assertEqual(self.client.post(self.url, self.payload, content_type='application/json').status_code, 403)
        self.assertEqual(configure.call_count, 1)

    @patch('mapper.configuration.configure_notification_channel', return_value='route-alerts')
    def test_changing_destination_clears_setup_state_but_warning_changes_preserve_it(self, configure):
        self.client.post(self.url, self.payload, content_type='application/json')
        settings = {'enabled': True, 'settings': {'discordChannelId': '500', 'warningMinutes': 25}}
        same = self.client.put(reverse('configure-mapper'), settings, content_type='application/json')
        self.assertTrue(same.json()['module']['discordChannel']['configured'])
        settings['settings']['discordChannelId'] = '600'
        changed = self.client.put(reverse('configure-mapper'), settings, content_type='application/json')
        self.assertEqual(changed.json()['module']['discordChannel'], {'name': '', 'configured': False})

    @patch('mapper.configuration.configure_notification_channel', side_effect=BotError('rate_limited', 12.5))
    def test_discord_rate_limit_returns_retry_after_without_claiming_success(self, configure):
        response = self.client.post(self.url, self.payload, content_type='application/json')
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Retry-After'], '13')
        self.assertEqual(response.json()['error'], 'rate_limited')
