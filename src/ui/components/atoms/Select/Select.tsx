import type { SelectHTMLAttributes } from 'react';

import './Select.css';

export interface OpcionSelect {
  readonly valor: string;
  readonly label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  readonly opciones: readonly OpcionSelect[];
  readonly valor: string;
  readonly onCambio: (valor: string) => void;
  /** Required. Every select on these screens sits in a table row with no visible label. */
  readonly etiqueta: string;
  readonly tamano?: 'md' | 'sm';
}

/**
 * Presentational.
 *
 * A native `<select>` and not a custom listbox: it is the one control that works with a
 * keyboard, a screen reader and a phone's own picker without any of it being reimplemented,
 * and the motivo dropdown is used dozens of times in a sitting by people who are fast at it.
 */
export function Select({
  opciones,
  valor,
  onCambio,
  etiqueta,
  tamano = 'md',
  className,
  ...resto
}: SelectProps) {
  const clases = ['select', `select--${tamano}`, className].filter(Boolean).join(' ');
  return (
    <select
      className={clases}
      value={valor}
      aria-label={etiqueta}
      onChange={(e) => onCambio(e.target.value)}
      {...resto}
    >
      {opciones.map((opcion) => (
        <option key={opcion.valor} value={opcion.valor}>
          {opcion.label}
        </option>
      ))}
    </select>
  );
}
