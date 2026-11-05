from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import GuildRole


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def assign_initial_role(sender, instance, created, **kwargs):
    if created:
        role = GuildRole.objects.filter(is_default=True).first()
        if role:
            role.members.add(instance)
