import { useTranslation } from 'react-i18next';

// HO artwork: https://www.albionmaps.com.br/tag-icons/tag-7.png
// Faction assets: oscarxdev/albion-icons (mirrored locally).
const hideoutIcon = '/static/avalon/icons/hideout-map.png';
export const isCity = (map) => ['city', 'starter'].includes(map.zone_type || map.zoneType);

export function cityIcon(map) {
  const city = map.name.replace(/ Portal$/, '');
  return `/static/avalon/icons/${cityPalette[city] ? `city-${city.toLowerCase().replaceAll(' ', '-')}` : 'city'}.png`;
}

export const zoneColors = { road: '#83cbe6', city: '#d8bc63', starter: '#9fb5c1', blue: '#78b8e7', yellow: '#d7bd59', red: '#d57c7c', black: '#9c90b6' };

const cityPalette = {
  Thetford: ['#e6dcf3', '#b59acb'],
  Lymhurst: ['#dbeadc', '#96b59a'],
  Martlock: ['#dce9fa', '#9ab5d2'],
  Bridgewatch: ['#f4e4bf', '#c8ae70'],
  'Fort Sterling': ['#f6f8fa', '#bac5cf'],
  Caerleon: ['#efdbdb', '#c39797'],
};

export function regionStyle(map) {
  const palette = mapPalette(map);
  return palette ? { '--region-bg': palette[0], '--region-border': palette[1] } : {};
}

export function mapPalette(map) {
  const kind = map.zone_type || map.zoneType || 'road';
  if (kind === 'road') return null;
  if (kind === 'black') return ['#454b54', '#737d8a'];
  const city = kind === 'city' && cityPalette[map.name.replace(/ Portal$/, '')];
  if (city) return city;
  const biomes = { highland: 'Martlock', forest: 'Lymhurst', swamp: 'Thetford', steppe: 'Bridgewatch', mountain: 'Fort Sterling' };
  return cityPalette[biomes[map.biome]] || null;
}

export function HideoutBadge({ map }) {
  const { t } = useTranslation('mapper');
  if (!map.is_hideout) return null;
  return <span className="hideout-badge" title={t('zones.hideout')} aria-label={t('zones.hideout')}>
    <img src={hideoutIcon} width="19" height="19" alt="" draggable="false" />
  </span>;
}

export function ZoneBadge({ map }) {
  const { t } = useTranslation('mapper');
  const kind = map.zone_type || 'road';
  if (isCity(map)) return <span className="city-badge" title={t(`zones.labels.${kind}`)} aria-label={t(`zones.labels.${kind}`)}>
    <img src={cityIcon(map)} width="22" height="22" alt="" draggable="false" />
  </span>;
  return <span className={`tier-badge ${kind === 'road' ? `t${map.tier}` : `zone-${kind}`}`} title={t(`zones.labels.${kind}`)}>
    {map.tier ? `T${map.tier}` : '—'}
  </span>;
}
