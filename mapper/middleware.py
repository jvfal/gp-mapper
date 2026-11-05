from datetime import timedelta

from django.utils import timezone

from .models import MemberActivity

INTERVAL = timedelta(minutes=1)
SESSION_KEY = 'mapper_last_access'


class MemberActivityMiddleware:
    """Record app visits, including the session polling while the mapper is open."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path in ('/', '/api/session/'):
            user = request.user
            if user.is_authenticated and user.is_active:
                now = timezone.now()
                previous = request.session.get(SESSION_KEY)
                if not isinstance(previous, dict) or previous.get('user') != str(user.pk) or now.timestamp() - previous.get('at', 0) >= INTERVAL.total_seconds():
                    activity, created = MemberActivity.objects.get_or_create(user=user, defaults={'last_access_at': now})
                    if not created and activity.last_access_at <= now - INTERVAL:
                        MemberActivity.objects.filter(user=user, last_access_at__lte=now - INTERVAL).update(last_access_at=now)
                    request.session[SESSION_KEY] = {'user': str(user.pk), 'at': now.timestamp()}
        return self.get_response(request)
