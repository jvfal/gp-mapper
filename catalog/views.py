from django.http import JsonResponse
from django.templatetags.static import static
from django.views.decorators.http import require_GET

from .models import RoadMap
from mapper.roles import site_access
from mapper.modules import mapper_enabled


def serialize_features(features, type_field):
    return [
        {
            'type': getattr(feature, type_field),
            'label': getattr(feature, f'get_{type_field}_display')(),
            'size': feature.size,
            'size_label': feature.get_size_display(),
            'count': feature.count,
            'icon_url': static(feature.icon_static_path),
        }
        for feature in features
    ]


@require_GET
def map_catalog(request):
    if not site_access(request.user):
        return JsonResponse({'error': 'permission_denied'}, status=403)
    if not mapper_enabled(request.user):
        return JsonResponse({'error': 'module_disabled'}, status=403)
    maps = RoadMap.objects.prefetch_related('resources', 'chests', 'dungeons')
    return JsonResponse({'maps': [
        {
            'id': roadmap.pk, 'name': roadmap.name, 'tier': roadmap.tier,
            'is_active': roadmap.is_active,
            'image_url': static(roadmap.image_static_path) if roadmap.image else None,
            'resources': serialize_features(roadmap.resources.all(), 'resource_type'),
            'chests': serialize_features(roadmap.chests.all(), 'chest_type'),
            'dungeons': serialize_features(roadmap.dungeons.all(), 'dungeon_type'),
        }
        for roadmap in maps
    ]})
