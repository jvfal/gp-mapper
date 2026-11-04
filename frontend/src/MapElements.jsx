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
export const CatalogContext = createContext(new Map());
export const EdgeContext = createContext({
  now: Date.now(),
  editEdge: () => {},
  canEdit: false,
});
export function FeatureChip({ feature }) {
  const { t } = useTranslation("mapper");
  const sizeLabel = feature.size === "unknown" ? "" : ` · ${t(`features.sizes.${feature.size}`)}`;
  const description = `${feature.count} × ${t(`features.types.${feature.type}`, { defaultValue: feature.type })}${sizeLabel}`;
  return (
    <span
      className={`feature-chip feature-${feature.size}`}
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
      {feature.size === "large" && (
        <span className="feature-size" aria-hidden="true">
          {t("features.largeBadge")}
        </span>
      )}
    </span>
  );
}
export const MapNode = memo(function MapNode({ data, selected }) {
  const { t } = useTranslation("mapper");
  const catalog = useContext(CatalogContext);
  const map = catalog.get(data.mapId);
  if (!map) return null;
  const rows = featureRows([...map.resources, ...map.chests, ...map.dungeons]);
  return (
    <article
      className={`road-card ${selected ? "is-selected" : ""}`}
      style={{
        "--handle-size": `${HANDLE_SIZE}px`,
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
        <span className={`tier-badge t${map.tier}`}>T{map.tier}</span>
        <h3>{map.name}</h3>
      </div>
      <div className="road-card-features">
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
        {!rows.length && <span className="muted">{t("features.empty")}</span>}
      </div>
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
      </EdgeLabelRenderer>
    </>
  );
}
