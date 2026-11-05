import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";
import { matchesMapName } from "./graph";
import { ZoneBadge, zoneColors } from './ZoneBadge';
export function MapSelect({ label, value, onChange, catalog, boardIds }) {
  const { t } = useTranslation("mapper");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const ref = useRef(null);
  const input = useRef(null);
  const selected = catalog.find((map) => map.id === value);
  const options = catalog.filter((map) => map.is_active !== false && matchesMapName(map.name, query));
  useEffect(() => {
    if (open)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({
        block: "nearest",
      });
  }, [open, active, id]);
  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  function choose(map) {
    onChange(map.id);
    setQuery("");
    setOpen(false);
    input.current?.focus();
  }
  return (
    <div className="map-select" ref={ref}>
      <label htmlFor={id}>{label}</label>
      <div className={`select-input ${open ? "is-open" : ""}`}>
        <Icon name="search" size={16} />
        <input
          ref={input}
          id={id}
          role="combobox"
          autoComplete="off"
          placeholder={t("select.placeholder")}
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && options[active] ? `${id}-option-${active}` : undefined
          }
          value={open ? query : selected?.name || ""}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActive(0);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    options.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (event.key === "Enter" && open) {
              event.preventDefault();
              if (options[active]) choose(options[active]);
            }
            if (event.key === "Tab") setOpen(false);
          }}
        />
        {selected && (
          <button
            type="button"
            className="input-clear"
            aria-label={t("select.clear", {
              field: label.toLowerCase(),
            })}
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
        <Icon name="chevron" size={14} />
      </div>
      {open && (
        <div
          className="select-options"
          id={`${id}-options`}
          role="listbox"
          aria-label={label}
        >
          <div className="options-caption">
            {query ? t("select.results") : t("catalog.caption")}
          </div>
          {options.map((map, index) => (
            <div
              role="option"
              tabIndex={-1}
              aria-selected={value === map.id}
              id={`${id}-option-${index}`}
              key={map.id}
              className={`select-option zone-${map.zone_type || 'road'} ${active === index ? "active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(map)}
            >
              <span className={`tier-dot t${map.tier}`} style={map.zone_type && map.zone_type !== 'road' ? { background: zoneColors[map.zone_type] } : undefined} />
              <span>{map.name}</span>
              {boardIds.has(map.id) && <small>{t("select.onBoard")}</small>}
              <span className="option-tier"><ZoneBadge map={map} /></span>
            </div>
          ))}
          {!options.length && <p className="no-results">{t("select.empty")}</p>}
        </div>
      )}
    </div>
  );
}
