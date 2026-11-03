import { useTranslation } from "react-i18next";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@xyflow/react";
import { Icon } from "./icons";
export function ConnectionCard({
  source,
  target,
  anchor,
  containerRef,
  areaRef,
  onConfirm,
  onCancel,
  initialDuration = 360,
  isEditing = false,
}) {
  const { t } = useTranslation("mapper");
  const cardRef = useRef(null);
  const inputRef = useRef(null);
  const titleId = useId();
  const transform = useStore((state) => state.transform);
  const [position, setPosition] = useState(null);
  const [hours, setHours] = useState(String(Math.floor(initialDuration / 60)));
  const [minutes, setMinutes] = useState(String(initialDuration % 60));
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    function reposition() {
      const container = containerRef.current;
      const area = areaRef.current;
      const card = cardRef.current;
      const handle = container?.querySelector(
        `.react-flow__handle[data-nodeid="${CSS.escape(anchor.nodeId)}"][data-handleid="${CSS.escape(anchor.handleId)}"]`,
      );
      if (!container || !area || !card || !handle) return;
      const origin = container.getBoundingClientRect();
      const bounds = area.getBoundingClientRect();
      const point = handle.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      const x = point.left + point.width / 2;
      const y = point.top + point.height / 2;
      const padding = 12;
      const placeLeft = x + 16 + rect.width > bounds.right - padding;
      const left = Math.max(
        bounds.left + padding,
        Math.min(
          placeLeft ? x - rect.width - 16 : x + 16,
          bounds.right - rect.width - padding,
        ),
      );
      const top = Math.max(
        bounds.top + padding,
        Math.min(y - 24, bounds.bottom - rect.height - padding),
      );
      setPosition({
        left: left - origin.left,
        top: top - origin.top,
        side: placeLeft ? "left" : "right",
      });
    }
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(cardRef.current);
    observer.observe(areaRef.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [transform, anchor.nodeId, anchor.handleId, containerRef, areaRef]);
  const ready = !!position;
  useEffect(() => {
    if (ready)
      inputRef.current?.focus({
        preventScroll: true,
      });
  }, [ready]);
  useEffect(() => {
    const outside = (event) => {
      if (!cardRef.current?.contains(event.target)) onCancel();
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [onCancel]);
  function submit(event) {
    event.preventDefault();
    const h = Number(hours),
      m = Number(minutes);
    if (
      !Number.isInteger(h) ||
      !Number.isInteger(m) ||
      h < 0 ||
      h > 23 ||
      m < 0 ||
      m > 59 ||
      h * 60 + m <= 0
    ) {
      setError("connection.invalidTime");
      return;
    }
    onConfirm(h * 60 + m);
  }
  return (
    <div
      ref={cardRef}
      className="connection-card nodrag nopan"
      data-connection-card
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: ready ? "visible" : "hidden",
      }}
    >
      <div className="connection-card-heading">
        <Icon name="clock" size={17} />
        <h2 id={titleId}>
          {isEditing ? t("connection.edit") : t("connection.remaining")}
        </h2>
        <button
          className="icon-button"
          type="button"
          onClick={onCancel}
          aria-label={t("connection.cancel")}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="connection-card-route">
        <span>{source.name}</span>
        <Icon name="arrow" size={13} />
        <span>{target.name}</span>
      </div>
      <form onSubmit={submit}>
        <div className="dialog-duration">
          <label>
            {t("common:time.hours")}
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              min="0"
              max="23"
              step="1"
              required
              value={hours}
              onChange={(event) => {
                setHours(event.target.value);
                setError("");
              }}
            />
          </label>
          <span>:</span>
          <label>
            {t("common:time.minutes")}
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max="59"
              step="1"
              required
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value);
                setError("");
              }}
            />
          </label>
        </div>
        {error && (
          <p className="dialog-error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel}>
            {t("common:actions.cancel")}
          </button>
          <button className="button primary" type="submit">
            <Icon name="check" size={15} />
            {isEditing ? t("connection.save") : t("connection.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
