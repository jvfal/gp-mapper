import { useTranslation } from "react-i18next";
import { createContext, memo, useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getBezierPath,
} from "@xyflow/react";
import { Icon } from "./icons";
import { featureRows, HANDLE_SIZE, remainingTime } from "./graph";
import { ZoneBadge, HideoutBadge, regionStyle } from './ZoneBadge';
export const CatalogContext = createContext(new Map());
export const AuditContext = createContext({ nodes: new Map(), edges: new Map() });
export const EdgeContext = createContext({
  now: Date.now(),
  editEdge: () => {},
  canEdit: false,
});
export function FeatureChip({ feature }) {
  const { t } = useTranslation("mapper");
  const highlightLarge = feature.type === "GOLD" && feature.size === "large";
  const sizeLabel = feature.size === "unknown" ? "" : ` · ${t(`features.sizes.${feature.size}`)}`;
  const description = `${feature.count} × ${t(`features.types.${feature.type}`, { defaultValue: feature.type })}${sizeLabel}`;
  return (
    <span
      className={`feature-chip${highlightLarge ? " feature-large" : ""}`}
      title={description}
      aria-label={description}
    >
      <img
        src={feature.icon_url}
        alt=""
        width="25"
        height="25"
        draggable="false"
      />
      <strong>{feature.count}</strong>
      {highlightLarge && (
        <span className="feature-size" aria-hidden="true">
          {t("features.largeBadge")}
        </span>
      )}
    </span>
  );
}
function AuditStamp({ audit, className = '', style }) {
  const { t, i18n } = useTranslation('mapper');
  if (!audit?.updatedAt && !audit?.createdAt) return null;
  const edited = audit.updatedAt && audit.updatedAt !== audit.createdAt;
  const at = edited ? audit.updatedAt : audit.createdAt;
  const by = (edited ? audit.updatedBy : audit.createdBy) || t('audit.unknownUser');
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleString(i18n.resolvedLanguage, { ...(sameDay ? {} : { day: '2-digit', month: '2-digit' }), hour: '2-digit', minute: '2-digit' });
  const full = (value) => new Date(value).toLocaleString(i18n.resolvedLanguage);
  const details = [
    audit.createdAt && t('audit.createdDetails', { name: audit.createdBy || t('audit.unknownUser'), date: full(audit.createdAt) }),
    edited && t('audit.updatedDetails', { name: by, date: full(at) }),
  ].filter(Boolean).join('\n');
  return <span className={`audit-stamp ${className}`} style={style} title={details} aria-label={details}>
    {t(edited ? 'audit.updated' : 'audit.created', { name: by, time })}
  </span>;
}
export const MapNode = memo(function MapNode({ data, selected }) {
  const { t } = useTranslation("mapper");
  const catalog = useContext(CatalogContext);
  const audits = useContext(AuditContext);
  const map = catalog.get(data.mapId);
  if (!map) return null;
  const rows = featureRows([...map.resources, ...map.chests, ...map.dungeons]);
  return (
    <article
      className={`road-card zone-${map.zone_type || 'road'} ${data.isHome ? 'is-home' : ''} ${selected ? "is-selected" : ""}`}
      style={{
        "--handle-size": `${HANDLE_SIZE}px`,
        ...regionStyle(map),
      }}
    >
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        aria-label={t("handles.top", {
          name: map.name,
        })}
      />
      <div className="road-card-heading">
        <ZoneBadge map={map} />
        <HideoutBadge map={map} />
        <h3>{map.name}</h3>
        {data.isHome && <span className="home-marker" title={t('home.label')} aria-label={t('home.label')}><Icon name="home" size={17} /></span>}
      </div>
      {rows.length > 0 && <div className="road-card-features">
        {rows.map((row, index) => (
          <div
            className="feature-row"
            key={index}
            style={{
              gridTemplateColumns: `repeat(${row.length}, minmax(0, 42px))`,
            }}
          >
            {row.map((feature) => (
              <FeatureChip
                key={`${feature.type}-${feature.size}`}
                feature={feature}
              />
            ))}
          </div>
        ))}
      </div>}
      <AuditStamp audit={audits.nodes.get(data.mapId)} className="road-card-audit" />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        aria-label={t("handles.bottom", {
          name: map.name,
        })}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        aria-label={t("handles.left", {
          name: map.name,
        })}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        aria-label={t("handles.right", {
          name: map.name,
        })}
      />
    </article>
  );
});
export function TimedEdge(props) {
  const { t } = useTranslation("mapper");
  const { now, editEdge, canEdit } = useContext(EdgeContext);
  const audits = useContext(AuditContext);
  // React Flow anchors edges to the outside of the enlarged hit area. Draw
  // from its center so lines meet the visible points and exported cards.
  const half = HANDLE_SIZE / 2;
  const offsets = {
    top: [0, half],
    bottom: [0, -half],
    left: [half, 0],
    right: [-half, 0],
  };
  const source = offsets[props.sourcePosition] || [0, 0];
  const target = offsets[props.targetPosition] || [0, 0];
  const [path, x, y] = getBezierPath({
    ...props,
    sourceX: props.sourceX + source[0],
    sourceY: props.sourceY + source[1],
    targetX: props.targetX + target[0],
    targetY: props.targetY + target[1],
  });
  const expired = props.data.expiresAt <= now;
  const time = remainingTime(
    props.data.expiresAt,
    now,
    t("connection.expired"),
  );
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        interactionWidth={24}
        style={{
          stroke: expired ? "#a75e62" : props.selected ? "#b6deff" : "#7fbfdd",
          strokeWidth: props.selected ? 4 : 3,
          strokeDasharray: expired ? "6 6" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`edge-time nodrag nopan ${expired ? "expired" : ""} ${props.selected ? "selected" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
          }}
          onClick={() => canEdit && editEdge(props.id)}
          aria-disabled={!canEdit}
          aria-label={t(
            canEdit ? "connection.editTime" : "sharing.connectionTime",
            {
              time: time,
            },
          )}
        >
          <Icon name="clock" size={12} />
          {time}
        </button>
        <AuditStamp audit={audits.edges.get(props.id)} className="edge-audit nodrag nopan" style={{ transform: `translate(-50%, 0) translate(${x}px, ${y + 17}px)` }} />
      </EdgeLabelRenderer>
    </>
  );
}
