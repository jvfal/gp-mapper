from django.conf import settings
from django.db import migrations


def seed_member_role(apps, schema_editor):
    alias = schema_editor.connection.alias
    Role = apps.get_model('mapper', 'GuildRole')
    User = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
    role, _ = Role.objects.using(alias).get_or_create(
        is_default=True,
        defaults={'name': 'Member', 'can_view_guild_maps': True, 'can_create_guild_maps': False},
    )
    role.members.add(*User.objects.using(alias).values_list('pk', flat=True))


class Migration(migrations.Migration):
    dependencies = [
        ('mapper', '0006_discordaccount_guild_id_discordaccount_is_member_and_more'),
    ]
    operations = [migrations.RunPython(seed_member_role, migrations.RunPython.noop)]
