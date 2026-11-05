import logging
import signal
from threading import Event

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from mapper.notifications import run_tick
from mapper.discord_bot import BotError, validate_channel
from mapper.models import MapperModuleSettings

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Send Discord route timer alerts; run as a persistent worker.'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='Run one scan and exit.')
        parser.add_argument('--check', action='store_true', help='Validate token and channel without sending messages.')

    def handle(self, *args, **options):
        if options['check']:
            config = MapperModuleSettings.objects.filter(module_id='mapper').first()
            if not settings.DISCORD_BOT_TOKEN or not settings.DISCORD_GUILD_ID or not config or not config.discord_channel_id:
                raise CommandError('Configure DISCORD_BOT_TOKEN, DISCORD_GUILD_ID and the notification channel first.')
            try:
                validate_channel(config.discord_channel_id)
            except BotError as error:
                raise CommandError(error.code) from None
            self.stdout.write(self.style.SUCCESS('Discord token and channel verified. No messages sent.'))
            return
        stop = Event()
        for name in ('SIGTERM', 'SIGINT'):
            signal.signal(getattr(signal, name), lambda *_: stop.set())
        self.stdout.write('Route notification worker started (15s polling).')
        while not stop.is_set():
            close_old_connections()
            try:
                run_tick()
            except Exception:
                logger.exception('Route notification scan failed')
                if options['once']:
                    raise
            finally:
                close_old_connections()
            if options['once']:
                break
            stop.wait(15)
