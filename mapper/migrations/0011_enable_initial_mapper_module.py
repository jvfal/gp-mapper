from django.db import migrations


def enable_mapper(apps, schema_editor):
    alias = schema_editor.connection.alias
    Module = apps.get_model('mapper', 'GuildModule')
    Settings = apps.get_model('mapper', 'MapperModuleSettings')
    module, _ = Module.objects.using(alias).get_or_create(code='mapper', defaults={'enabled': True})
    Settings.objects.using(alias).get_or_create(module=module)


class Migration(migrations.Migration):
    dependencies = [('mapper', '0010_guildmodule_mappermodulesettings')]
    operations = [migrations.RunPython(enable_mapper, migrations.RunPython.noop)]
