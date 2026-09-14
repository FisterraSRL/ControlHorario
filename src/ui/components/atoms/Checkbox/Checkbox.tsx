import './Checkbox.css';

export interface CheckboxProps {
  readonly marcado: boolean;
  readonly onCambio: (marcado: boolean) => void;
  readonly children: string;
  readonly disabled?: boolean;
}

/**
 * Presentational. A native checkbox with its label, because the label has to be clickable
 * and a `<div role="checkbox">` gets that wrong in a different way on every browser.
 */
export function Checkbox({ marcado, onCambio, children, disabled = false }: CheckboxProps) {
  return (
    <label className={`checkbox${disabled ? ' checkbox--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={marcado}
        disabled={disabled}
        onChange={(e) => onCambio(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
