from django.shortcuts import render
from django.views.decorators.http import require_GET
from django.views.decorators.vary import vary_on_headers
from django.views.decorators.csrf import ensure_csrf_cookie

from .localization import page_translations, request_language


@require_GET
@ensure_csrf_cookie
@vary_on_headers('Cookie', 'Accept-Language')
def index(request):
    language = request_language(request)
    return render(request, 'mapper/index.html', {
        'mapper_language': language,
        'mapper_page': page_translations(language),
    })
