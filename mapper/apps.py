from django.apps import AppConfig


class MapperConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'mapper'

    def ready(self):
        from . import signals  # noqa: F401
