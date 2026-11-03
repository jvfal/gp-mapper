import { useState } from "react";
import { FeatureChip } from "./MapElements";
import { Icon } from "./icons";
import { matchesMapName } from "./graph";

export function CatalogDrawer({ catalog, nodes, addMap, close }) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState(null);
  const ids = new Set(nodes.map((node) => node.data.mapId));
  const maps = catalog.filter(
    (map) => (!tier || map.tier === tier) && matchesMapName(map.name, query),
  );
  return (
    <aside className="map-drawer" aria-label="Catálogo de mapas">
      <div className="drawer-heading">
        <div>
          <span className="eyebrow">AVALON ROADS</span>
          <h2>Catálogo de mapas</h2>
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Fechar catálogo"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="drawer-search">
        <Icon name="search" size={17} />
        <input
          autoFocus
          aria-label="Buscar no catálogo"
          placeholder="Nome ou iniciais, ex.: ca ai"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="tier-filters" aria-label="Filtrar por tier">
        {[null, 4, 6, 8].map((value) => (
          <button
            key={value || "all"}
            className={tier === value ? "active" : ""}
            aria-pressed={tier === value}
            onClick={() => setTier(value)}
          >
            {value ? `Tier ${value}` : "Todos"}
          </button>
        ))}
      </div>
      <p className="catalog-count">
        {maps.length}{" "}
        {maps.length === 1 ? "mapa encontrado" : "mapas encontrados"}
      </p>
      <div className="catalog-list">
        {maps.map((map) => (
          <button
            className="catalog-item"
            key={map.id}
            onClick={() => addMap(map)}
            aria-label={`${ids.has(map.id) ? "Localizar" : "Adicionar"} ${map.name}`}
          >
            <span className={`tier-badge t${map.tier}`}>T{map.tier}</span>
            <span className="catalog-map-name">
              {map.name}
              <small>
                {map.resources.length} recursos · {map.chests.length} baús
              </small>
            </span>
            <span
              className={ids.has(map.id) ? "catalog-added" : "catalog-plus"}
            >
              <Icon name={ids.has(map.id) ? "check" : "plus"} size={16} />
            </span>
          </button>
        ))}
        {!maps.length && (
          <p className="no-results">Nenhum mapa com esse nome e tier.</p>
        )}
      </div>
    </aside>
  );
}

export function MapInspector({ map, close }) {
  return (
    <aside
      className="map-drawer inspector"
      aria-label={`Detalhes de ${map.name}`}
    >
      <div className="drawer-heading">
        <div>
          <span className="eyebrow">DETALHES DO MAPA</span>
          <h2>{map.name}</h2>
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Fechar detalhes"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="inspector-content">
        {map.image_url && (
          <div className="map-image">
            <img src={map.image_url} alt={`Mapa de ${map.name}`} />
          </div>
        )}
        <div className="map-summary">
          <span className={`tier-badge t${map.tier}`}>T{map.tier}</span>
          <span>Avalon Road</span>
        </div>
        {[
          ["Recursos", map.resources],
          ["Baús", map.chests],
          ["Dungeons", map.dungeons],
        ].map(([label, items]) => (
          <section className="detail-section" key={label}>
            <h3>
              {label}
              <span>{items.reduce((sum, item) => sum + item.count, 0)}</span>
            </h3>
            {items.map((feature) => (
              <div
                className="detail-feature"
                key={`${feature.type}-${feature.size}`}
              >
                <FeatureChip feature={feature} />
                <span>
                  {feature.label}
                  <small>{feature.size_label}</small>
                </span>
              </div>
            ))}
            {!items.length && <p className="muted">Nenhum registro.</p>}
          </section>
        ))}
      </div>
    </aside>
  );
}
