from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import Board, BoardAccess, DiscordAccount, GuildRole


@override_settings(DISCORD_GUILD_ID='', DISCORD_MEMBER_ROLE_ID='', CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class MemberRoleTests(TestCase):
    def setUp(self):
        self.gm = get_user_model().objects.create_user(username='gm')
        self.gm.groups.add(Group.objects.get(name='Guild Master'))
        self.member = get_user_model().objects.create_user(username='member')
        self.client.force_login(self.member)

    def test_gm_grants_guild_creation_without_changing_private_or_map_edit_permissions(self):
        url = reverse('board-list')
        self.assertEqual(self.client.post(url, {'name': 'Guild', 'scope': 'guild'}, content_type='application/json').status_code, 403)
        private = self.client.post(url, {'name': 'Mine', 'scope': 'private'}, content_type='application/json').json()['board']
        promotion = {'scope': 'guild', 'guildCanView': True, 'guildCanEdit': False, 'users': []}
        self.assertEqual(self.client.put(reverse('board-access', args=[private['id']]), promotion, content_type='application/json').status_code, 403)
        self.assertEqual(self.client.get(reverse('guild-members')).status_code, 403)
        self.client.force_login(self.gm)
        response = self.client.post(reverse('guild-roles'), {
            'name': 'Cartographers', 'canViewGuildMaps': True, 'canCreateGuildMaps': True,
        }, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        role = response.json()['role']
        response = self.client.put(reverse('member-roles', args=[self.member.pk]), {'roleIds': [role['id']]}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.client.force_login(self.member)
        self.assertEqual(self.client.post(url, {'name': 'Guild', 'scope': 'guild'}, content_type='application/json').status_code, 201)
        other = Board.objects.create(owner=self.gm, name='GM map', scope='guild')
        board = self.client.get(reverse('board-detail', args=[other.pk])).json()['board']
        self.assertEqual(board['permissions'], {'canView': True, 'canEdit': False, 'canManage': False})
        self.client.force_login(self.gm)
        self.client.put(reverse('member-roles', args=[self.member.pk]), {'roleIds': []}, content_type='application/json')
        BoardAccess.objects.create(board=other, user=self.member, can_view=True, can_edit=True)
        self.client.force_login(self.member)
        self.assertEqual(self.client.get(reverse('board-detail', args=[other.pk])).status_code, 404)
        self.assertEqual(self.client.get(reverse('board-detail', args=[private['id']])).status_code, 200)

    def test_role_management_cannot_promote_a_guild_master_or_delete_the_default_role(self):
        self.client.force_login(self.gm)
        role = GuildRole.objects.get(is_default=True)
        self.assertEqual(self.client.delete(reverse('guild-role-detail', args=[role.pk])).status_code, 400)
        self.assertEqual(self.client.post(reverse('guild-roles'), {
            'name': 'Guild Master', 'canViewGuildMaps': True, 'canCreateGuildMaps': True,
        }, content_type='application/json').status_code, 400)
        self.assertEqual(self.client.put(reverse('member-roles', args=[self.gm.pk]), {'roleIds': []}, content_type='application/json').status_code, 400)
        self.assertFalse(self.member.is_staff or self.member.is_superuser)

    def test_gm_can_configure_a_discord_role_id_and_unlinking_clears_only_automatic_assignments(self):
        self.client.force_login(self.gm)
        data = {'name': 'Discord cartographers', 'discordRoleId': '555555555',
                'canViewGuildMaps': True, 'canCreateGuildMaps': True}
        response = self.client.post(reverse('guild-roles'), data, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['role']['discordRoleId'], '555555555')
        role = GuildRole.objects.get(pk=response.json()['role']['id'])
        role.members.add(self.member)
        role.discord_members.add(self.member)
        data['discordRoleId'] = ''
        self.assertEqual(self.client.put(reverse('guild-role-detail', args=[role.pk]), data, content_type='application/json').status_code, 200)
        self.assertTrue(role.members.filter(pk=self.member.pk).exists())
        self.assertFalse(role.discord_members.exists())
        data['discordRoleId'] = 'not-an-id'
        self.assertEqual(self.client.put(reverse('guild-role-detail', args=[role.pk]), data, content_type='application/json').status_code, 400)


@override_settings(
    DISCORD_CLIENT_ID='client', DISCORD_CLIENT_SECRET='secret',
    DISCORD_REDIRECT_URI='https://testserver/auth/discord/callback/',
    DISCORD_GUILD_ID='123456789', DISCORD_MEMBER_ROLE_ID='987654321',
)
class DiscordMembershipTests(TestCase):
    profile = {'id': '123123123', 'username': 'player', 'global_name': 'Player'}

    @patch('mapper.authentication.discord_profile')
    def test_legacy_session_requests_discord_refresh_until_next_login(self, profile):
        user = get_user_model().objects.create_user(username='legacy-status')
        DiscordAccount.objects.create(user=user, discord_id=self.profile['id'], username='player', display_name='Player')
        self.client.force_login(user)
        info = self.client.get(reverse('current-session')).json()['user']
        self.assertTrue(info['discordNeedsRefresh'])
        self.assertTrue(info['discordLoginAvailable'])
        profile.return_value = {**self.profile, '_guild_member': True}
        state = self.start()
        self.client.get(reverse('discord-callback'), {'code': 'again', 'state': state})
        info = self.client.get(reverse('current-session')).json()['user']
        self.assertFalse(info['discordNeedsRefresh'])
        self.assertTrue(info['canAccess'])

    def test_manual_approval_binds_legacy_account_and_revocation_blocks_access(self):
        from django.test import Client
        user = get_user_model().objects.create_user(username='legacy-player')
        account = DiscordAccount.objects.create(user=user, discord_id='111222333', username='legacy', display_name='Legacy', is_member=True)
        gm = get_user_model().objects.create_user(username='legacy-approver')
        gm.groups.add(Group.objects.get(name='Guild Master'))
        manager = Client()
        manager.force_login(gm)
        self.client.force_login(user)
        self.assertTrue(self.client.get(reverse('current-session')).json()['user']['approvalPending'])
        url = reverse('member-approval', args=[user.pk])
        self.assertEqual(manager.put(url, {'approved': True}, content_type='application/json').status_code, 200)
        account.refresh_from_db()
        self.assertEqual(account.guild_id, '123456789')
        self.assertEqual(account.approval_guild_id, '123456789')
        self.assertFalse(account.is_member)
        self.assertEqual(account.approved_by_id, gm.pk)
        self.assertTrue(self.client.get(reverse('current-session')).json()['user']['canAccess'])
        self.assertTrue(user.guild_roles.filter(is_default=True).exists())
        self.assertEqual(manager.put(url, {'approved': False}, content_type='application/json').status_code, 200)
        self.assertFalse(self.client.get(reverse('current-session')).json()['user']['canAccess'])

    def test_approval_does_not_rebind_an_account_from_another_guild(self):
        user = get_user_model().objects.create_user(username='other-guild-player')
        account = DiscordAccount.objects.create(user=user, discord_id='999222333', username='other', display_name='Other', guild_id='another-guild')
        gm = get_user_model().objects.create_user(username='guild-approver')
        gm.groups.add(Group.objects.get(name='Guild Master'))
        self.client.force_login(gm)
        response = self.client.put(reverse('member-approval', args=[user.pk]), {'approved': True}, content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'invalid_guild')
        account.refresh_from_db()
        self.assertEqual(account.guild_id, 'another-guild')
        self.assertFalse(account.manually_approved)

    def start(self):
        response = self.client.get(reverse('discord-login'))
        query = parse_qs(urlsplit(response.url).query)
        self.assertIn('guilds.members.read', query['scope'][0])
        return query['state'][0]

    @patch('mapper.authentication.discord_json')
    def test_valid_member_is_created_with_default_role_and_correct_guild_endpoint(self, discord):
        state = self.start()
        discord.side_effect = [{'access_token': 'token'}, self.profile, {'roles': ['987654321']}]
        response = self.client.get(reverse('discord-callback'), {'code': 'code', 'state': state})
        self.assertEqual(response.url, '/')
        account = DiscordAccount.objects.get(discord_id=self.profile['id'])
        self.assertTrue(account.is_member)
        self.assertEqual(account.guild_id, '123456789')
        self.assertTrue(account.user.guild_roles.filter(is_default=True).exists())
        self.assertEqual(discord.call_args.args[0].full_url, 'https://discord.com/api/v10/users/@me/guilds/123456789/member')
        info = self.client.get(reverse('board-list')).json()['user']
        self.assertTrue(info['canAccess'])
        self.assertFalse(info['permissions']['canCreateGuildMaps'])
        self.assertFalse(info['isGuildMaster'])

    @patch('mapper.authentication.discord_json')
    def test_discord_roles_are_added_and_removed_on_login_without_removing_manual_roles(self, discord):
        automatic = GuildRole.objects.create(name='Auto cartographer', discord_role_id='555555555', can_create_guild_maps=True)
        state = self.start()
        discord.side_effect = [{'access_token': 'token'}, self.profile, {'roles': ['987654321', '555555555']}]
        self.client.get(reverse('discord-callback'), {'code': 'code', 'state': state})
        account = DiscordAccount.objects.get(discord_id=self.profile['id'])
        self.assertTrue(account.user.discord_guild_roles.filter(pk=automatic.pk).exists())
        self.assertFalse(account.user.guild_roles.filter(pk=automatic.pk).exists())
        self.assertTrue(self.client.get(reverse('board-list')).json()['user']['permissions']['canCreateGuildMaps'])
        manual = GuildRole.objects.create(name='Manually assigned')
        account.user.guild_roles.add(manual)
        self.client.logout()
        state = self.start()
        discord.side_effect = [{'access_token': 'token'}, self.profile, {'roles': ['987654321']}]
        self.client.get(reverse('discord-callback'), {'code': 'again', 'state': state})
        self.assertFalse(account.user.discord_guild_roles.exists())
        self.assertTrue(account.user.guild_roles.filter(pk=manual.pk).exists())
        self.assertFalse(self.client.get(reverse('board-list')).json()['user']['permissions']['canCreateGuildMaps'])

    @patch('mapper.authentication.discord_profile')
    def test_non_member_logs_in_pending_without_access_to_maps_or_management(self, profile):
        profile.return_value = {**self.profile, '_guild_member': False}
        state = self.start()
        response = self.client.get(reverse('discord-callback'), {'code': 'code', 'state': state})
        self.assertEqual(response.url, '/')
        account = DiscordAccount.objects.get(discord_id=self.profile['id'])
        self.assertFalse(account.is_member)
        self.assertFalse(account.user.guild_roles.exists())
        listing = self.client.get(reverse('board-list')).json()
        self.assertEqual(listing['boards'], [])
        self.assertFalse(listing['user']['canAccess'])
        self.assertTrue(listing['user']['approvalPending'])
        self.assertEqual(self.client.get(reverse('map-catalog')).status_code, 403)
        self.assertEqual(self.client.get(reverse('guild-members')).status_code, 403)
        self.assertEqual(self.client.put(reverse('member-approval', args=[account.user_id]), {'approved': True}, content_type='application/json').status_code, 403)
        self.assertEqual(self.client.post(reverse('board-list'), {'name': 'Mine'}, content_type='application/json').status_code, 401)

    @patch('mapper.authentication.discord_profile')
    def test_gm_approval_survives_login_and_revocation_blocks_the_existing_session(self, profile):
        from django.test import Client
        from .realtime import AccessDenied, read_board

        profile.return_value = {**self.profile, '_guild_member': False}
        state = self.start()
        self.client.get(reverse('discord-callback'), {'code': 'code', 'state': state})
        account = DiscordAccount.objects.get(discord_id=self.profile['id'])
        gm = get_user_model().objects.create_user(username='approver')
        gm.groups.add(Group.objects.get(name='Guild Master'))
        manager = Client()
        manager.force_login(gm)
        approval_url = reverse('member-approval', args=[account.user_id])
        self.assertEqual(manager.put(approval_url, {'approved': True}, content_type='application/json').status_code, 200)
        account.refresh_from_db()
        self.assertEqual(account.approved_by_id, gm.pk)
        self.assertIsNotNone(account.approved_at)
        self.assertTrue(account.manually_approved)
        self.assertTrue(account.user.guild_roles.filter(is_default=True).exists())
        self.assertTrue(self.client.get(reverse('board-list')).json()['user']['canAccess'])
        self.client.logout()
        state = self.start()
        self.client.get(reverse('discord-callback'), {'code': 'again', 'state': state})
        self.assertTrue(self.client.get(reverse('board-list')).json()['user']['canAccess'])
        with self.settings(DISCORD_GUILD_ID='555555555'):
            self.assertFalse(self.client.get(reverse('board-list')).json()['user']['canAccess'])
        board = Board.objects.create(owner=account.user, name='Personal')
        self.assertEqual(manager.put(approval_url, {'approved': False}, content_type='application/json').status_code, 200)
        self.assertTrue(self.client.get(reverse('board-list')).json()['user']['approvalPending'])
        self.assertEqual(self.client.get(reverse('board-detail', args=[board.pk])).status_code, 401)
        with self.assertRaises(AccessDenied):
            read_board(board.pk, self.client.session.session_key)

    @patch('mapper.authentication.discord_profile')
    def test_pending_member_can_gain_access_automatically_after_receiving_discord_role(self, profile):
        profile.return_value = {**self.profile, '_guild_member': False}
        state = self.start()
        self.client.get(reverse('discord-callback'), {'code': 'code', 'state': state})
        profile.return_value = {**self.profile, '_guild_member': True}
        state = self.start()
        self.client.get(reverse('discord-callback'), {'code': 'again', 'state': state})
        self.assertTrue(self.client.get(reverse('board-list')).json()['user']['canAccess'])
        self.assertEqual(DiscordAccount.objects.count(), 1)
