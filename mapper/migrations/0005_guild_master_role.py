from django.db import migrations


def create_guild_master_group(apps, schema_editor):
    apps.get_model('auth', 'Group').objects.using(schema_editor.connection.alias).get_or_create(
        name='Guild Master',
    )


class Migration(migrations.Migration):
    dependencies = [
        ('mapper', '0004_discordaccount'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [migrations.RunPython(create_guild_master_group, migrations.RunPython.noop)]
