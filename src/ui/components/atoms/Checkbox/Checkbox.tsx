import { useEffect, useRef } from 'react';

import './Checkbox.css';

export interface CheckboxProps {
  readonly marcado: boolean;
  readonly onCambio: (marcado: boolean) => void;
  readonly children: string;
  readonly disabled?: boolean;
  /**
   * The partial tick of a "select all" over a list where only some rows are ticked. Takes
   * precedence over `marcado` visually; a click still reports `!marcado`, so a partial
   * selection becomes a full one, which is what every native "select all" does.
   */
  readonly indeterminado?: boolean;
  /**
   * Keeps the label for screen readers and hides it on screen, for a checkbox in a table
   * cell whose meaning the row already shows. The label is never dropped: an unlabelled
   * checkbox is announced as just "checkbox".
   */
  readonly etiquetaOculta?: boolean;
}

/**
 * Presentational. A native checkbox with its label, because the label has to be clickable
 * and a `<div role="checkbox">` gets that wrong in a different way on every browser.
 *
 * `indeterminate` is a DOM property with no HTML attribute, so React cannot render it; it is
 * set on the element after every render. Every render and not only when the prop changes,
 * because a click clears it in the DOM without React knowing. Browsers expose the native
 * property as "mixed" to assistive technology, so no `aria-checked` is added on top.
 */
export function Checkbox({
  marcado,
  onCambio,
  children,
  disabled = false,
  indeterminado = false,
  etiquetaOculta = false,
}: CheckboxProps) {
  const entrada = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (entrada.current) entrada.current.indeterminate = indeterminado;
  });

  return (
    <label className={`checkbox${disabled ? ' checkbox--disabled' : ''}`}>
      <input
        ref={entrada}
        type="checkbox"
        checked={marcado}
        disabled={disabled}
        onChange={(e) => onCambio(e.target.checked)}
      />
      <span className={etiquetaOculta ? 'checkbox__texto--oculto' : undefined}>{children}</span>
    </label>
  );
}
