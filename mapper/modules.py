"""Available application modules and their installation settings."""
from .models import GuildModule


def module_states():
    states = {GuildModule.Code.MAPPER: True}
    states.update(GuildModule.objects.values_list('code', 'enabled'))
    return states


def mapper_enabled(user=None):
    if user is not None and hasattr(user, '_mapper_module_enabled'):
        return user._mapper_module_enabled
    enabled = GuildModule.objects.filter(code=GuildModule.Code.MAPPER).values_list('enabled', flat=True).first()
    enabled = True if enabled is None else enabled
    if user is not None:
        user._mapper_module_enabled = enabled
    return enabled
