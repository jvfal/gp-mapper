import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';
import { zoneColors, cityIcon, isCity, mapPalette } from './ZoneBadge';

const width = 220;
const height = 70;

function anchor(node, handle) {
  if (handle === 'left') return [node.x, node.y + height / 2];
  if (handle === 'right') return [node.x + width, node.y + height / 2];
  if (handle === 'top') return [node.x + width / 2, node.y];
  return [node.x + width / 2, node.y + height];
}

function BoardPreview({ preview, now }) {
  const { t } = useTranslation('mapper');
  const patternId = useId();
  const nodes = preview?.nodes || [];
  if (!nodes.length) return <div className="board-preview board-preview-empty" aria-hidden="true">
    <Icon name="layout" size={36} /><span>{t('library.previewEmpty')}</span>
  </div>;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const left = Math.min(...nodes.map((node) => node.x)) - 60;
  const top = Math.min(...nodes.map((node) => node.y)) - 60;
  const graphWidth = Math.max(...nodes.map((node) => node.x)) + width + 60 - left;
  const graphHeight = Math.max(...nodes.map((node) => node.y)) + height + 60 - top;
  return <div className="board-preview" aria-hidden="true">
    <svg viewBox={`${left} ${top} ${graphWidth} ${graphHeight}`} preserveAspectRatio="xMidYMid meet">
      <defs><pattern id={patternId} width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.2" fill="#3c505d" /></pattern></defs>
      <rect x={left} y={top} width={graphWidth} height={graphHeight} fill={`url(#${patternId})`} />
      {(preview.edges || []).map((edge, index) => {
        const source = byId.get(edge.source), target = byId.get(edge.target);
        if (!source || !target) return null;
        const [x1, y1] = anchor(source, edge.sourceHandle), [x2, y2] = anchor(target, edge.targetHandle);
        const expired = edge.expiresAt <= now;
        return <path key={index} d={`M${x1},${y1} L${x2},${y2}`} fill="none" stroke={expired ? '#53606b' : '#83cbe6'} strokeWidth="4" strokeDasharray={expired ? '8 6' : undefined} />;
      })}
      {nodes.map((node) => <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
        <rect width={width} height={height} rx="12" fill={mapPalette(node)?.[0] || '#263640'} stroke={node.isHome ? '#c49c49' : mapPalette(node)?.[1] || '#688999'} strokeWidth={node.isHome ? '3' : '1.5'} />
        <rect width="4" height="34" x="0" y="18" rx="2" fill={zoneColors[node.zoneType || 'road']} />
        <text x="16" y="30" fill={mapPalette(node) && node.zoneType !== 'black' ? '#263640' : '#f0f4f6'} fontSize="14" fontWeight="600">{node.name.length > 24 ? node.name.slice(0, 23) + '…' : node.name}</text>
        {isCity(node) ? <><rect x="13" y="37" width="27" height="27" rx="4" fill="#33434e" /><image href={cityIcon(node)} x="15" y="38" width="24" height="24" /></> : <text x="16" y="52" fill={mapPalette(node) && node.zoneType !== 'black' ? '#52616d' : '#bdc6d0'} fontSize="11">{node.tier ? `T${node.tier}` : '—'}</text>}
      </g>)}
    </svg>
  </div>;
}

export function BoardCard({ board, busy, onOpen, onDelete }) {
  const { t, i18n } = useTranslation('mapper');
  const now = Date.now();
  const active = (board.preview?.edges || []).filter((edge) => edge.expiresAt > now);
  const next = active.length ? Math.min(...active.map((edge) => edge.expiresAt)) : null;
  const relative = next ? new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: 'always' }).format(Math.max(1, Math.ceil((next - now) / 60000)), 'minute') : null;
  return <article className="board-card-wrapper"><button className={`saved-board board-card ${board.scope === 'guild' ? 'board-card-guild' : ''}`} disabled={busy} onClick={() => onOpen(board)} aria-label={`${t('library.open')}: ${board.name}`}>
    <div className="board-card-cover">
      <BoardPreview preview={board.preview} now={now} />
      <span className={`board-cover-badge ${board.scope}`}><Icon name={board.scope === 'guild' ? 'guild' : 'compass'} size={13} />{t('sharing.filter_' + board.scope)}</span>
    </div>
    <div className="board-card-content">
      <div className="board-card-title"><h3>{board.name}</h3><Icon name="arrow" size={20} /></div>
      <div className="board-card-stats"><span><Icon name="layout" size={14} />{t('board.maps', { count: board.nodeCount })}</span><span><Icon name="link" size={14} />{t('board.connections', { count: board.connectionCount })}</span></div>
      <div className={`board-route-status${active.length ? ' has-routes' : ''}`}><span className="route-status-dot" />{t(active.length ? 'library.activeRoutes' : 'library.noActiveRoutes', { count: active.length })}</div>
      <span className="board-next-expiry">{next ? t('library.nextExpiry', { time: relative }) : t('library.readyToExplore')}</span>
      <div className="board-card-bottom"><small>{t('library.updated', { date: new Date(board.updatedAt).toLocaleDateString(i18n.resolvedLanguage, { day: 'numeric', month: 'short' }) })}</small><span className="board-card-access">{t(board.permissions.canEdit ? 'sharing.editor' : 'sharing.viewer')}</span></div>
      <span className="saved-board-open">{t('library.open')}<Icon name="arrow" size={16} /></span>
    </div>
  </button>
    {board.canDelete && <button type="button" className="icon-button board-card-delete" disabled={busy} onClick={() => onDelete(board)} title={t('library.deleteNamed', { name: board.name })} aria-label={t('library.deleteNamed', { name: board.name })}><Icon name="trash" size={15} /></button>}
  </article>;
}
