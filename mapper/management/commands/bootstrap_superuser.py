from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Cria o superusuario inicial sem alterar contas existentes.'

    def handle(self, *args, **options):
        if not settings.BOOTSTRAP_SUPERUSER:
            self.stdout.write('Criacao do superusuario inicial desabilitada.')
            return
        user_model = get_user_model()
        username = settings.BOOTSTRAP_SUPERUSER_USERNAME
        user, created = user_model.objects.get_or_create(
            **{user_model.USERNAME_FIELD: username},
            defaults={
                user_model.get_email_field_name(): settings.BOOTSTRAP_SUPERUSER_EMAIL,
                'password': lambda: make_password(settings.BOOTSTRAP_SUPERUSER_PASSWORD),
                'is_staff': True, 'is_superuser': True, 'is_active': True,
            },
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f'Superusuario inicial {username} criado.'))
        elif not user.is_superuser or not user.is_staff:
            self.stdout.write(self.style.WARNING(f'A conta {username} ja existe e nao e superusuario; nenhuma permissao foi alterada.'))
        else:
            self.stdout.write(f'Superusuario {username} ja existe; senha preservada.')
