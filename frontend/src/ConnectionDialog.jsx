import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";

export function ConnectionDialog({
  source,
  target,
  onConfirm,
  onCancel,
  initialDuration = 360,
  isEditing = false,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const [hours, setHours] = useState(String(Math.floor(initialDuration / 60)));
  const [minutes, setMinutes] = useState(String(initialDuration % 60));
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

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
      setError(
        "Informe um tempo maior que zero, com até 23 horas e 59 minutos.",
      );
      return;
    }
    onConfirm(h * 60 + m);
  }

  return (
    <dialog
      ref={dialogRef}
      className="connection-dialog"
      aria-labelledby={titleId}
      onCancel={onCancel}
    >
      <div className="dialog-heading">
        <span className="dialog-icon">
          <Icon name="link" size={21} />
        </span>
        <button
          className="icon-button"
          type="button"
          onClick={onCancel}
          aria-label="Cancelar conexão"
        >
          <Icon name="close" />
        </button>
      </div>
      <span className="eyebrow">
        {isEditing ? "EDITAR CONEXÃO" : "NOVA CONEXÃO"}
      </span>
      <h2 id={titleId}>
        {isEditing ? "Editar conexão" : "Quanto tempo resta?"}
      </h2>
      <p>Defina o tempo restante deste portal para concluir a conexão.</p>
      <div className="dialog-route">
        <span>{source.name}</span>
        <Icon name="arrow" size={17} />
        <span>{target.name}</span>
      </div>
      <form onSubmit={submit}>
        <div className="dialog-duration">
          <label>
            Horas
            <input
              autoFocus
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
            Minutos
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
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button className="button primary" type="submit">
            <Icon name="check" size={17} />
            {isEditing ? "Salvar conexão" : "Criar conexão"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
