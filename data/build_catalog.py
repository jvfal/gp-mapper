"""Build maps.json from the downloaded source files; never writes to the DB."""

import json
from collections import Counter
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parent
RESOURCE_TYPES = {
    'LOGS': 'WOOD', 'ROCK': 'STONE', 'ORE': 'ORE',
    'COTTON': 'FIBER', 'HIRE': 'HIDE',
}
CHEST_PROPERTIES = {7: 'GREEN', 8: 'BLUE', 9: 'GOLD'}
# The PNG referenced by the tracker returns 404; its WebP is available under this name.
IMAGE_OVERRIDES = {'Qiient-In-Tersom': 'img_webp/Qiient-In-Tersom t6.webp'}


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def unique_by_name(rows, field):
    result = {}
    for row in rows:
        key = row[field].casefold()
        if key in result:
            raise ValueError(f'Duplicate map: {row[field]}')
        result[key] = row
    return result


def main():
    tracker = unique_by_name(read(ROOT / 'avalonroads/data.json'), 'name')
    sugar = unique_by_name(
        [row for row in read(ROOT / 'sugarfox/zoneData.json') if row['type'] == 6],
        'displayName',
    )
    components = {row['Id']: row for row in read(ROOT / 'sugarfox/zoneComponentsData.json')}
    existing = unique_by_name(read(ROOT.parent / 'maps.json')['maps'], 'name')
    next_id = max(row['id'] for row in existing.values()) + 1
    maps, conflicts = [], []
    chest_count = unknown_resources = unknown_dungeons = 0

    for name, source in sorted(tracker.items()):
        if name not in sugar:
            raise ValueError(f'Missing SugarF0x map; cannot determine chests: {source["name"]}')
        sugar_counts = Counter()
        if name in sugar:
            for component_id in sugar[name]['components']:
                component = components[component_id]
                if component['Type'] != 1:
                    continue
                properties = set(component['Properties'])
                colors = properties & CHEST_PROPERTIES.keys()
                sizes = properties & {0, 1}
                if len(colors) != 1 or len(sizes) != 1:
                    raise ValueError(f'Invalid chest component: {component_id}')
                color = CHEST_PROPERTIES[next(iter(colors))]
                size = 'small' if 0 in sizes else 'large'
                sugar_counts[color, size] += 1

        counts = Counter()
        for icon in source['icons']:
            kind, count = icon['alt'].upper(), icon.get('badge', 1)
            if kind == 'HIDE':
                kind = 'HIRE'
            if type(count) is not int or count < 1:
                raise ValueError(f'Invalid count: {source["name"]} / {kind}')
            if kind not in {*RESOURCE_TYPES, *CHEST_PROPERTIES.values(), 'DUNGEON'}:
                raise ValueError(f'Unknown icon: {kind}')
            counts[kind] += count

        chests = []
        for color in CHEST_PROPERTIES.values():
            total = counts[color]
            split = {size: sugar_counts[color, size] for size in ('small', 'large')}
            chests.extend(
                {'type': color, 'size': size, 'count': count}
                for size, count in split.items() if count
            )
            chest_count += sum(split.values())
            if total != sum(split.values()):
                conflicts.append({
                    'map': source['name'], 'type': color,
                    'tracker_count': total, 'sugarfox_sizes': split,
                    'selected_source': 'sugarfox',
                })

        resources = [
            {'type': resource_type, 'size': 'unknown', 'count': counts[kind]}
            for kind, resource_type in RESOURCE_TYPES.items() if counts[kind]
        ]
        dungeons = (
            [{'type': 'DUNGEON', 'size': 'unknown', 'count': counts['DUNGEON']}]
            if counts['DUNGEON'] else []
        )
        unknown_resources += sum(row['count'] for row in resources)
        unknown_dungeons += counts['DUNGEON']
        map_id = existing[name]['id'] if name in existing else next_id
        if name not in existing:
            next_id += 1
        image_url = None
        image_file = ''
        if source.get('img') and not source.get('missing_screenshot', False):
            image_path = IMAGE_OVERRIDES.get(source['name'], source['img'])
            image_url = 'https://avalonroads-97617.web.app/' + quote(image_path, safe='/')
            image_file = f'survey_{source["name"]}_T{source["tier"]}{Path(image_path).suffix}'
        maps.append({
            'id': map_id, 'name': source['name'], 'tier': int(source['tier']),
            'image': image_file,
            'image_source_url': image_url,
            'chests': chests, 'resources': resources, 'dungeons': dungeons,
        })

    report = {
        'map_count': len(maps),
        'preserved_ids': len(tracker.keys() & existing.keys()),
        'new_maps': len(tracker.keys() - existing.keys()),
        'existing_maps_absent_from_tracker': [
            existing[key]['name'] for key in sorted(existing.keys() - tracker.keys())
        ],
        'maps_absent_from_sugarfox': [
            tracker[key]['name'] for key in sorted(tracker.keys() - sugar.keys())
        ],
        'chests_from_sugarfox': chest_count,
        'chest_differences_resolved_with_sugarfox': conflicts,
        'resources_without_size': unknown_resources,
        'dungeons_without_classification': unknown_dungeons,
    }
    write(ROOT.parent / 'maps.json', {
        'complete_catalog': True,
        'sources': {
            'resources_dungeons_tiers_images': 'https://avalonroads-97617.web.app/data.json',
            'chests': 'https://github.com/SugarF0x/albion-navigator',
        },
        'maps': maps,
    })
    write(ROOT / 'catalog-comparison.json', report)
    print(json.dumps({
        key: value for key, value in report.items()
        if key != 'chest_differences_resolved_with_sugarfox'
    }, indent=2))
    print(f'Chest differences resolved with SugarF0x: {len(conflicts)}')


if __name__ == '__main__':
    main()
