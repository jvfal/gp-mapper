"""Download the images referenced by maps.json. Run: python data/download_map_images.py"""

import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import ssl
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / 'static/avalon/maps'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
PNG_END = b'\x00\x00\x00\x00IEND\xaeB`\x82'


def valid_image(path):
    if not path.is_file() or path.stat().st_size < 45:
        return False
    with path.open('rb') as image:
        header = image.read(24)
        image.seek(-12, 2)
        trailer = image.read()
        # A few tracker URLs end in .png but contain a JPEG; preserve the source bytes.
        if header.startswith(b'\xff\xd8\xff'):
            return trailer.endswith(b'\xff\xd9')
        if header.startswith(b'RIFF') and header[8:12] == b'WEBP':
            return int.from_bytes(header[4:8], 'little') + 8 == path.stat().st_size
        return (
            header.startswith(PNG_SIGNATURE) and header[12:16] == b'IHDR'
            and int.from_bytes(header[16:20], 'big') > 0
            and int.from_bytes(header[20:24], 'big') > 0
            and trailer == PNG_END
        )


def download(row, overwrite, context):
    filename, url = row['image'], row['image_source_url']
    if Path(filename).name != filename or not filename.startswith('survey_') or Path(filename).suffix not in {'.png', '.webp'}:
        raise ValueError(f'Invalid image filename: {filename}')
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc != 'avalonroads-97617.web.app' or not parsed.path.startswith(('/img/', '/img_webp/')):
        raise ValueError(f'Invalid image URL: {url}')
    target = DESTINATION / filename
    if not overwrite and valid_image(target):
        return 'skipped'
    temporary = target.with_suffix(target.suffix + '.part')
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'gp-mapper-catalog/1.0'})
            with urlopen(request, timeout=30, context=context) as response, temporary.open('wb') as output:
                while chunk := response.read(64 * 1024):
                    output.write(chunk)
            if not valid_image(temporary):
                raise ValueError('Response is not a complete PNG, JPEG or WebP image')
            temporary.replace(target)
            return 'downloaded'
        except (OSError, URLError, ValueError):
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, choices=range(1, 9), default=4)
    parser.add_argument('--overwrite', action='store_true', help='Download even if a valid file exists.')
    parser.add_argument('--corporate-ca-compat', action='store_true',
                        help='Accept older corporate CA certificates; still verifies TLS certificates and hostnames.')
    args = parser.parse_args()
    context = ssl.create_default_context()
    if args.corporate_ca_compat:
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    rows = json.loads((ROOT / 'maps.json').read_text(encoding='utf-8'))['maps']
    rows = [row for row in rows if row.get('image') and row.get('image_source_url')]
    if len({row['image'] for row in rows}) != len(rows):
        raise ValueError('Duplicate destination image filenames')
    DESTINATION.mkdir(parents=True, exist_ok=True)
    totals = {'downloaded': 0, 'skipped': 0, 'failed': 0}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(download, row, args.overwrite, context): row['name'] for row in rows}
        for completed, future in enumerate(as_completed(futures), 1):
            try:
                totals[future.result()] += 1
            except Exception as exc:
                totals['failed'] += 1
                print(f'FAILED {futures[future]}: {exc}', flush=True)
            if completed % 25 == 0 or completed == len(rows):
                print(f'{completed}/{len(rows)}: {totals}', flush=True)
    if totals['failed']:
        raise SystemExit('Some images failed. Run the command again to retry only missing images.')
    hashes = defaultdict(list)
    for row in rows:
        hashes[hashlib.sha256((DESTINATION / row['image']).read_bytes()).hexdigest()].append(row['name'])
    report = {
        'downloaded_images': len(rows),
        'distinct_images': len(hashes),
        'shared_images': [names for names in hashes.values() if len(names) > 1],
    }
    (ROOT / 'data/image-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
    )
    print(f'Images: {len(rows)} files, {len(hashes)} distinct contents.')


if __name__ == '__main__':
    main()
