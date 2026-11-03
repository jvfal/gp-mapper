import { createContext, memo, useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getBezierPath,
} from "@xyflow/react";
import { Icon } from "./icons";
import { remainingTime } from "./graph";

export const CatalogContext = createContext(new Map());
export const EdgeContext = createContext({
  now: Date.now(),
  editEdge: () => {},
});

export function FeatureChip({ feature }) {
  const description = `${feature.count} × ${feature.label} · ${feature.size_label}`;
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
          G
        </span>
      )}
    </span>
  );
}

export const MapNode = memo(function MapNode({ data, selected }) {
  const catalog = useContext(CatalogContext);
  const map = catalog.get(data.mapId);
  if (!map) return null;
  const extras = [...map.chests, ...map.dungeons];
  return (
    <article className={`road-card ${selected ? "is-selected" : ""}`}>
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        aria-label={`Conectar ao topo de ${map.name}`}
      />
      <div className="road-card-heading">
        <span className={`tier-badge t${map.tier}`}>T{map.tier}</span>
        <h3>{map.name}</h3>
      </div>
      <div className="road-card-features">
        {map.resources.length > 0 && (
          <div className="feature-group" aria-label="Recursos">
            {map.resources.map((feature) => (
              <FeatureChip
                key={`${feature.type}-${feature.size}`}
                feature={feature}
              />
            ))}
          </div>
        )}
        {extras.length > 0 && (
          <div
            className="feature-group feature-extras"
            aria-label="Baús e dungeons"
          >
            {extras.map((feature) => (
              <FeatureChip
                key={`${feature.type}-${feature.size}`}
                feature={feature}
              />
            ))}
          </div>
        )}
        {!map.resources.length && !extras.length && (
          <span className="muted">Sem recursos catalogados</span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        aria-label={`Conectar à base de ${map.name}`}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        aria-label={`Conectar à esquerda de ${map.name}`}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        aria-label={`Conectar à direita de ${map.name}`}
      />
    </article>
  );
});

export function TimedEdge(props) {
  const { now, editEdge } = useContext(EdgeContext);
  const [path, x, y] = getBezierPath(props);
  const expired = props.data.expiresAt <= now;
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
          onClick={() => editEdge(props.id)}
          aria-label={`Editar conexão: ${remainingTime(props.data.expiresAt, now)}`}
        >
          <Icon name="clock" size={12} />
          {remainingTime(props.data.expiresAt, now)}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
