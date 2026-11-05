from django.shortcuts import render
from django.conf import settings
from django.views.decorators.http import require_GET
from django.views.decorators.vary import vary_on_headers
from django.views.decorators.csrf import ensure_csrf_cookie

from .localization import page_translations, request_language
from .branding import branding_info


@require_GET
@ensure_csrf_cookie
@vary_on_headers('Cookie', 'Accept-Language')
def index(request):
    language = request_language(request)
    return render(request, 'mapper/index.html', {
        'mapper_language': language,
        'mapper_page': {
            **page_translations(language),
            'title': page_translations(language)['title'].replace('{{guild}}', settings.GUILD_NAME),
        },
        'guild_name': settings.GUILD_NAME,
        'guild_icon_url': branding_info()['iconUrl'] or '',
    })
