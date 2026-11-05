from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import MemberActivity


@override_settings(DISCORD_GUILD_ID='', DISCORD_MEMBER_ROLE_ID='', STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class MemberActivityTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='active-player')

    def test_access_updates_existing_session_once_per_minute_without_changing_login(self):
        self.client.force_login(self.user)
        self.user.refresh_from_db()
        login = self.user.last_login
        now = timezone.now()
        for seconds in (0, 20, 65):
            with patch('mapper.middleware.timezone.now', return_value=now + timedelta(seconds=seconds)):
                self.assertEqual(self.client.get(reverse('current-session')).status_code, 200)
            activity = MemberActivity.objects.get(user=self.user)
            self.assertEqual(activity.last_access_at, now if seconds < 60 else now + timedelta(seconds=65))
        self.user.refresh_from_db()
        self.assertEqual(self.user.last_login, login)

    def test_anonymous_and_admin_requests_do_not_record_app_activity(self):
        self.client.get(reverse('current-session'))
        self.assertFalse(MemberActivity.objects.exists())
        self.client.force_login(self.user)
        self.client.get('/admin/login/')
        self.assertFalse(MemberActivity.objects.exists())

    def test_member_card_serializes_access_and_does_not_invent_historical_visits(self):
        gm = get_user_model().objects.create_user(username='activity-gm')
        gm.groups.add(Group.objects.get(name='Guild Master'))
        self.client.force_login(gm)
        response = self.client.get(reverse('guild-members')).json()
        member = next(item for item in response['members'] if item['id'] == self.user.pk)
        self.assertIsNone(member['lastAccessAt'])
        at = timezone.now() - timedelta(hours=2)
        MemberActivity.objects.create(user=self.user, last_access_at=at)
        response = self.client.get(reverse('guild-members')).json()
        member = next(item for item in response['members'] if item['id'] == self.user.pk)
        self.assertEqual(member['lastAccessAt'], at.isoformat())
