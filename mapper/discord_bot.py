"""Small HTTP client; never log Discord responses or authorization headers."""
import json
import math
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.views.decorators.debug import sensitive_variables


class BotError(Exception):
    def __init__(self, code, retry_after=60):
        self.code = code
        self.retry_after = retry_after
        super().__init__(code)


def retry_delay(value):
    try:
        seconds = float(value)
        return max(1, seconds) if math.isfinite(seconds) else 60
    except (TypeError, ValueError):
        return 60


@sensitive_variables()
def discord_request(path, payload=None, *, method=None):
    request = Request(
        'https://discord.com/api/v10' + path,
        data=json.dumps(payload).encode('utf-8') if payload is not None else None,
        method=method,
        headers={
            'Authorization': 'Bot ' + settings.DISCORD_BOT_TOKEN,
            'Content-Type': 'application/json',
            'User-Agent': 'DiscordBot (https://github.com/jvfal/gp-mapper, 1.0)',
        },
    )
    context = ssl.create_default_context()
    if settings.DISCORD_CORPORATE_CA_COMPAT:
        # Some corporate CAs omit AKI; retain chain and hostname verification.
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    try:
        with urlopen(request, timeout=10, context=context) as response:
            result = None if response.status == 204 else json.load(response)
            # Proactively respect successful responses that exhaust the bucket.
            delay = retry_delay(response.headers.get('X-RateLimit-Reset-After')) if response.headers.get('X-RateLimit-Remaining') == '0' else 0
            return result, delay
    except HTTPError as error:
        if error.code == 429:
            try:
                delay = retry_delay(json.load(error).get('retry_after'))
            except (ValueError, AttributeError):
                delay = retry_delay(error.headers.get('Retry-After'))
            raise BotError('rate_limited', delay) from None
        code = {401: 'invalid_token', 403: 'missing_permissions', 404: 'channel_not_found'}.get(error.code, 'discord_error')
        raise BotError(code) from None
    except URLError as error:
        code = 'certificate_error' if isinstance(error.reason, ssl.SSLCertVerificationError) else 'connection_error'
        raise BotError(code) from None
    except (TimeoutError, OSError, ValueError):
        raise BotError('connection_error') from None


def validate_channel(channel_id):
    channel, delay = discord_request(f'/channels/{channel_id}')
    if not isinstance(channel, dict) or channel.get('guild_id') != settings.DISCORD_GUILD_ID:
        raise BotError('wrong_guild')
    if channel.get('type') not in (0, 5):
        raise BotError('invalid_channel_type')
    return delay
