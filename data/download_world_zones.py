"""Refresh mainland tiers from the game's extracted world data."""

import argparse
import json
from pathlib import Path
import re
import ssl
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent
REPOSITORY = 'ao-data/ao-bin-dumps'
BIOMES = {'HL': 'highland', 'FR': 'forest', 'SW': 'swamp', 'ST': 'steppe', 'MN': 'mountain'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corporate-ca-compat', action='store_true')
    args = parser.parse_args()
    context = ssl.create_default_context()
    if args.corporate_ca_compat:
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT

    def fetch(url):
        request = Request(url, headers={'User-Agent': 'gp-mapper-catalog/1.0'})
        with urlopen(request, context=context, timeout=30) as response:
            return response.read()

    revision = json.loads(fetch(f'https://api.github.com/repos/{REPOSITORY}/commits/master'))['sha']
    source = f'https://raw.githubusercontent.com/{REPOSITORY}/{revision}/cluster/world.xml'
    world = ET.fromstring(fetch(source))
    names = {row['displayName'].casefold() for row in json.loads(
        (ROOT / 'sugarfox/zoneData.json').read_text(encoding='utf-8-sig')
    ) if row['type'] != 6}
    zones = []
    for cluster in world.iter('cluster'):
        name = cluster.get('displayname', '')
        if cluster.get('enabled') != 'true' or name.casefold() not in names:
            continue
        match = re.search(r'_T([1-8])_', cluster.get('file', ''))
        if not match:
            raise ValueError(f'Missing tier: {name}')
        biome = re.search(r'_(?:WRL|CTY|STT|HBS)_([A-Z]+)_', cluster.get('file', ''))
        zones.append({'name': name, 'cluster_id': cluster.get('id'), 'tier': int(match[1]),
                      'biome': BIOMES.get(biome[1], '') if biome else ''})
    found = {zone['name'].casefold() for zone in zones}
    if found != names or len(zones) != len(names):
        raise ValueError(f'Incomplete or ambiguous mainland catalog: {sorted(names - found)}')
    output = ROOT / 'ao-data/world-zones.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'source': source, 'revision': revision,
                                 'zones': sorted(zones, key=lambda zone: zone['name'])},
                                ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {len(zones)} mainland tiers at revision {revision[:12]}.')


if __name__ == '__main__':
    main()
