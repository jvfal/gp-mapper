import struct
import zlib

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .branding import MAX_ICON_BYTES, PNG_SIGNATURE


def png_icon():
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)
    return (PNG_SIGNATURE + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\x00\x20\x40\x60\xff')) + chunk(b'IEND', b''))


@override_settings(DISCORD_GUILD_ID='', DISCORD_MEMBER_ROLE_ID='', STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class BrandingTests(TestCase):
    def setUp(self):
        self.gm = get_user_model().objects.create_user(username='branding-gm')
        self.gm.groups.add(Group.objects.get(name='Guild Master'))
        self.member = get_user_model().objects.create_user(username='branding-member')
        self.client.force_login(self.gm)
        self.url = reverse('configure-branding')

    def test_icon_is_persisted_served_safely_and_can_be_restored_to_default(self):
        self.assertIsNone(self.client.get(reverse('current-session')).json()['branding']['iconUrl'])
        response = self.client.post(self.url, {'icon': SimpleUploadedFile('icon.png', png_icon(), content_type='image/png')})
        self.assertEqual(response.status_code, 200)
        icon_url = response.json()['branding']['iconUrl']
        self.assertEqual(self.client.get(reverse('current-session')).json()['branding']['iconUrl'], icon_url)
        image = self.client.get(icon_url)
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.content, png_icon())
        self.assertEqual(image['Content-Type'], 'image/png')
        self.assertEqual(image['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(self.client.get(icon_url, HTTP_IF_NONE_MATCH=image['ETag']).status_code, 304)
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['branding']['iconUrl'])
        self.assertEqual(self.client.get(icon_url).status_code, 404)

    def test_members_cannot_change_icon_and_invalid_uploads_are_rejected(self):
        self.client.force_login(self.member)
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.assertEqual(self.client.post(self.url, {'icon': SimpleUploadedFile('icon.png', png_icon())}).status_code, 403)
        self.client.force_login(self.gm)
        for content in (b'<svg onload="alert(1)"></svg>', png_icon()[:-1], b'x' * (MAX_ICON_BYTES + 1)):
            with self.subTest(length=len(content)):
                self.assertEqual(self.client.post(self.url, {'icon': SimpleUploadedFile('icon.png', content)}).status_code, 400)
