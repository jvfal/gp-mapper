import { useTranslation } from "react-i18next";
import { useState } from "react";
import { FeatureChip } from "./MapElements";
import { Icon } from "./icons";
import { matchesMapName } from "./graph";
export function CatalogDrawer({ catalog, nodes, addMap, close }) {
  const { t } = useTranslation("mapper");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState(null);
  const ids = new Set(nodes.map((node) => node.data.mapId));
  const maps = catalog.filter(
    (map) => (!tier || map.tier === tier) && matchesMapName(map.name, query),
  );
  return (
    <aside className="map-drawer" aria-label={t("catalog.title")}>
      <div className="drawer-heading">
        <div>
          <span className="eyebrow">AVALON ROADS</span>
          <h2>{t("catalog.title")}</h2>
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label={t("catalog.close")}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="drawer-search">
        <Icon name="search" size={17} />
        <input
          autoFocus
          aria-label={t("catalog.search")}
          placeholder={t("catalog.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="tier-filters" aria-label={t("catalog.filterTier")}>
        {[null, 4, 6, 8].map((value) => (
          <button
            key={value || "all"}
            className={tier === value ? "active" : ""}
            aria-pressed={tier === value}
            onClick={() => setTier(value)}
          >
            {value
              ? t("catalog.tier", {
                  tier: value,
                })
              : t("catalog.all")}
          </button>
        ))}
      </div>
      <p className="catalog-count">
        {t("catalog.found", { count: maps.length })}
      </p>
      <div className="catalog-list">
        {maps.map((map) => (
          <button
            className="catalog-item"
            key={map.id}
            onClick={() => addMap(map)}
            aria-label={`${ids.has(map.id) ? t("common:actions.locate") : t("common:actions.add")} ${map.name}`}
          >
            <span className={`tier-badge t${map.tier}`}>T{map.tier}</span>
            <span className="catalog-map-name">
              {map.name}
              <small>
                {t("catalog.resources", { count: map.resources.length })} ·{" "}
                {t("catalog.chests", { count: map.chests.length })}
              </small>
            </span>
            <span
              className={ids.has(map.id) ? "catalog-added" : "catalog-plus"}
            >
              <Icon name={ids.has(map.id) ? "check" : "plus"} size={16} />
            </span>
          </button>
        ))}
        {!maps.length && <p className="no-results">{t("catalog.noResults")}</p>}
      </div>
    </aside>
  );
}
export function MapInspector({ map, close }) {
  const { t } = useTranslation("mapper");
  return (
    <aside
      className="map-drawer inspector"
      aria-label={t("details.title", {
        name: map.name,
      })}
    >
      <div className="drawer-heading">
        <div>
          <span className="eyebrow">{t("details.caption")}</span>
          <h2>{map.name}</h2>
        </div>
        <button
          className="icon-button"
          onClick={close}
          aria-label={t("details.close")}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="inspector-content">
        {map.image_url && (
          <div className="map-image">
            <img
              src={map.image_url}
              alt={t("details.image", {
                name: map.name,
              })}
            />
          </div>
        )}
        <div className="map-summary">
          <span className={`tier-badge t${map.tier}`}>T{map.tier}</span>
          <span>Avalon Road</span>
        </div>
        {[
          [t("details.resources"), map.resources],
          [t("details.chests"), map.chests],
          [t("details.dungeons"), map.dungeons],
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
                  {t(`features.types.${feature.type}`, {
                    defaultValue: feature.type,
                  })}
                  <small>{t(`features.sizes.${feature.size}`)}</small>
                </span>
              </div>
            ))}
            {!items.length && <p className="muted">{t("details.empty")}</p>}
          </section>
        ))}
      </div>
    </aside>
  );
}
