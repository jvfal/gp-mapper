from io import StringIO
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from .models import DiscordAccount


@override_settings(
    DISCORD_GUILD_ID='', DISCORD_MEMBER_ROLE_ID='',
    DISCORD_CLIENT_ID='test-client', DISCORD_CLIENT_SECRET='test-secret',
    DISCORD_REDIRECT_URI='https://testserver/auth/discord/callback/',
    BOOTSTRAP_SUPERUSER=True, BOOTSTRAP_SUPERUSER_USERNAME='dev',
    BOOTSTRAP_SUPERUSER_PASSWORD='devdev333', BOOTSTRAP_SUPERUSER_EMAIL='dev@dev.com',
    STORAGES={
        'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
        'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
    },
)
class AuthenticationTests(TestCase):
    profile = {'id': '123456789012345678', 'username': 'player', 'global_name': 'Roads Player',
               'email': 'dev@dev.com', 'verified': True, 'avatar': None}

    def start(self, next_url='/'):
        response = self.client.get(reverse('discord-login'), {'next': next_url})
        self.assertEqual(response.status_code, 302)
        query = parse_qs(urlsplit(response.url).query)
        self.assertEqual(query['scope'], ['identify email'])
        self.assertEqual(query['redirect_uri'], ['https://testserver/auth/discord/callback/'])
        return query['state'][0]

    def test_bootstrap_creates_once_preserves_password_and_does_not_promote_existing_user(self):
        output = StringIO()
        call_command('bootstrap_superuser', stdout=output)
        user = get_user_model().objects.get(username='dev')
        self.assertEqual(user.email, 'dev@dev.com')
        self.assertTrue(user.is_superuser and user.is_staff and user.check_password('devdev333'))
        user.set_password('changed-password')
        user.save()
        call_command('bootstrap_superuser', stdout=output)
        user.refresh_from_db()
        self.assertTrue(user.check_password('changed-password'))
        self.assertEqual(get_user_model().objects.filter(username='dev').count(), 1)
        user.is_staff = user.is_superuser = False
        user.save()
        call_command('bootstrap_superuser', stdout=output)
        user.refresh_from_db()
        self.assertFalse(user.is_staff or user.is_superuser)

    @patch('mapper.authentication.discord_profile')
    def test_login_creates_regular_user_reuses_discord_id_and_does_not_link_admin_email(self, profile):
        profile.return_value = self.profile
        call_command('bootstrap_superuser', stdout=StringIO())
        state = self.start('/?board=example')
        response = self.client.get(reverse('discord-callback'), {'state': state, 'code': 'code', 'iss': 'https://discord.com'})
        self.assertRedirects(response, '/?board=example', fetch_redirect_response=False)
        account = DiscordAccount.objects.get(discord_id=self.profile['id'])
        user = account.user
        self.assertEqual(str(user.pk), self.client.session['_auth_user_id'])
        self.assertFalse(user.is_superuser or user.is_staff or user.has_usable_password())
        self.assertNotEqual(user.pk, get_user_model().objects.get(username='dev').pk)
        info = self.client.get(reverse('board-list')).json()
        self.assertEqual(info['user']['name'], 'Roads Player')
        self.assertFalse(info['user']['isStaff'])
        self.assertFalse(info['user']['isGuildMaster'])
        self.assertEqual(self.client.get(reverse('mapper-logout')).status_code, 405)
        self.client.post(reverse('mapper-logout'))
        self.assertNotIn('_auth_user_id', self.client.session)
        user.groups.add(Group.objects.get(name='Guild Master'))
        state = self.start('https://untrusted.invalid/steal')
        profile.return_value = {**self.profile, 'global_name': 'New Name'}
        response = self.client.get(reverse('discord-callback'), {'state': state, 'code': 'new-code'})
        self.assertRedirects(response, '/', fetch_redirect_response=False)
        self.assertEqual(DiscordAccount.objects.count(), 1)
        self.assertEqual(str(user.pk), self.client.session['_auth_user_id'])
        self.assertEqual(self.client.get(reverse('board-list')).json()['user']['name'], 'New Name')
        self.assertTrue(self.client.get(reverse('board-list')).json()['user']['isGuildMaster'])

    @patch('mapper.authentication.discord_profile')
    def test_state_is_required_expires_and_cannot_be_replayed(self, profile):
        profile.return_value = self.profile
        state = self.start()
        callback = reverse('discord-callback')
        response = self.client.get(callback, {'state': 'wrong', 'code': 'code'})
        self.assertIn('auth_error=expired', response.url)
        profile.assert_not_called()
        outsider = Client()
        self.assertIn('auth_error=expired', outsider.get(callback, {'state': state, 'code': 'code'}).url)
        self.client.get(callback, {'state': state, 'code': 'code'})
        profile.assert_called_once()
        response = self.client.get(callback, {'state': state, 'code': 'code'})
        self.assertIn('auth_error=expired', response.url)
        self.assertEqual(profile.call_count, 1)
        self.client.logout()
        state = self.start()
        session = self.client.session
        session['discord_oauth_attempts'][state]['created'] = 0
        session.save()
        self.assertIn('auth_error=expired', self.client.get(callback, {'state': state, 'code': 'code'}).url)
        self.assertEqual(profile.call_count, 1)

    @patch('mapper.authentication.discord_profile')
    def test_cancel_provider_failure_and_inactive_account(self, profile):
        callback = reverse('discord-callback')
        state = self.start()
        self.assertIn('auth_error=cancelled', self.client.get(callback, {'state': state, 'error': 'access_denied'}).url)
        profile.assert_not_called()
        state = self.start()
        profile.side_effect = TimeoutError()
        self.assertIn('auth_error=failed', self.client.get(callback, {'state': state, 'code': 'code'}).url)
        self.assertNotIn('_auth_user_id', self.client.session)
        profile.side_effect = None
        profile.return_value = self.profile
        state = self.start()
        self.client.get(callback, {'state': state, 'code': 'code'})
        user = DiscordAccount.objects.get().user
        self.client.logout()
        user.is_active = False
        user.save()
        state = self.start()
        self.assertIn('auth_error=inactive', self.client.get(callback, {'state': state, 'code': 'code'}).url)
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_logout_requires_csrf_and_disabled_discord_does_not_start_flow(self):
        client = Client(enforce_csrf_checks=True)
        user = get_user_model().objects.create_user(username='local')
        client.force_login(user)
        self.assertEqual(client.post(reverse('mapper-logout')).status_code, 403)
        client.get(reverse('mapper'))
        self.assertEqual(client.post(reverse('mapper-logout'), HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value).status_code, 302)
        self.assertNotIn('_auth_user_id', client.session)
        with override_settings(DISCORD_CLIENT_SECRET=''):
            self.assertIn('auth_error=unavailable', self.client.get(reverse('discord-login')).url)
            self.assertFalse(self.client.get(reverse('board-list')).json()['auth']['discordEnabled'])
