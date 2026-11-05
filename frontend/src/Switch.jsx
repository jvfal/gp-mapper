export function Switch({ checked, onChange, disabled = false, label, controls, className = "" }) {
  return <label className={`switch-control ${className}${disabled ? " is-disabled" : ""}`}>
    <span className="switch-body">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} aria-controls={controls} />
      <span className="switch-track" aria-hidden="true" />
    </span>
    <span>{label}</span>
  </label>;
}
