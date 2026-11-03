"""Mapper-only language selection; Django admin keeps its own configuration."""

import json
from functools import lru_cache

from django.conf import settings


def supported_language(value):
    return {'pt': 'pt-BR', 'en': 'en-US', 'es': 'es'}.get(
        value.lower().replace('_', '-').split('-')[0]
    )


def request_language(request):
    preference = supported_language(request.COOKIES.get('avalon_roads_language', ''))
    if preference:
        return preference
    candidates = []
    for entry in request.headers.get('Accept-Language', '').split(','):
        language, _, quality = entry.strip().partition(';q=')
        try:
            weight = float(quality) if quality else 1.0
        except ValueError:
            continue
        supported = supported_language(language)
        if supported and 0 < weight <= 1:
            candidates.append((weight, supported))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1] if candidates else 'en-US'


@lru_cache(maxsize=3)
def page_translations(language):
    path = settings.BASE_DIR / 'frontend' / 'src' / 'locales' / language / 'mapper.json'
    with path.open(encoding='utf-8') as source:
        return json.load(source)['page']
