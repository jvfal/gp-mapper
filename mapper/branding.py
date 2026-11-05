import hashlib
import struct
import zlib

from django.http import Http404, HttpResponse, HttpResponseNotModified, JsonResponse
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_http_methods

from .models import GuildBranding
from .roles import guild_permissions

MAX_ICON_BYTES = 512 * 1024
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def branding_info():
    digest = GuildBranding.objects.filter(pk=1).values_list('icon_digest', flat=True).first()
    return {'iconUrl': reverse('guild-icon', kwargs={'digest': digest}) if digest else None}


def normalized_png(data):
    """Validate a bounded 256px PNG from the browser canvas and discard metadata."""
    if len(data) > MAX_ICON_BYTES or not data.startswith(PNG_SIGNATURE):
        raise ValueError('invalid_icon')
    offset, compressed, output = 8, bytearray(), [PNG_SIGNATURE]
    width = height = channels = 0
    finished = False
    while offset + 12 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], 'big')
        kind = data[offset + 4:offset + 8]
        end = offset + length + 12
        if end > len(data):
            raise ValueError('invalid_icon')
        payload = data[offset + 8:end - 4]
        if zlib.crc32(kind + payload) & 0xffffffff != int.from_bytes(data[end - 4:end], 'big'):
            raise ValueError('invalid_icon')
        if kind == b'IHDR':
            if offset != 8 or length != 13:
                raise ValueError('invalid_icon')
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', payload)
            channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color, 0)
            if not (1 <= width <= 256 and 1 <= height <= 256 and channels and depth == 8
                    and compression == filtering == interlace == 0):
                raise ValueError('invalid_icon')
        elif kind == b'IDAT':
            if not width:
                raise ValueError('invalid_icon')
            compressed.extend(payload)
        elif kind == b'IEND':
            if length or end != len(data) or not compressed:
                raise ValueError('invalid_icon')
            finished = True
        elif not kind[0] & 32 and kind != b'PLTE':
            raise ValueError('invalid_icon')
        if kind in (b'IHDR', b'IDAT', b'IEND'):
            output.append(data[offset:end])
        offset = end
    if not finished or offset != len(data):
        raise ValueError('invalid_icon')
    stride = width * channels + 1
    decoder = zlib.decompressobj()
    try:
        pixels = decoder.decompress(bytes(compressed), stride * height + 1)
    except zlib.error as error:
        raise ValueError('invalid_icon') from error
    if (not decoder.eof or decoder.unused_data or decoder.unconsumed_tail
            or len(pixels) != stride * height or any(pixels[row * stride] > 4 for row in range(height))):
        raise ValueError('invalid_icon')
    return b''.join(output)


@never_cache
@require_http_methods(['POST', 'DELETE'])
def configure_branding(request):
    if not guild_permissions(request.user)['canManageSettings']:
        return JsonResponse({'error': 'permission_denied'}, status=403)
    data = b''
    if request.method == 'POST':
        uploaded = request.FILES.get('icon')
        if uploaded is None or uploaded.size > MAX_ICON_BYTES:
            return JsonResponse({'error': 'invalid_icon'}, status=400)
        try:
            data = normalized_png(uploaded.read(MAX_ICON_BYTES + 1))
        except ValueError:
            return JsonResponse({'error': 'invalid_icon'}, status=400)
    GuildBranding.objects.update_or_create(pk=1, defaults={
        'icon_data': data, 'icon_digest': hashlib.sha256(data).hexdigest() if data else '',
    })
    return JsonResponse({'branding': branding_info()})


@require_GET
def guild_icon(request, digest):
    icon = GuildBranding.objects.filter(pk=1, icon_digest=digest).first()
    if not icon or not icon.icon_data:
        raise Http404
    etag = f'"{icon.icon_digest}"'
    response = HttpResponseNotModified() if request.headers.get('If-None-Match') == etag else HttpResponse(bytes(icon.icon_data), content_type='image/png')
    response['ETag'] = etag
    response['Cache-Control'] = 'public, max-age=31536000, immutable'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "default-src 'none'; sandbox"
    response['Content-Disposition'] = 'inline; filename="guild-icon.png"'
    return response
