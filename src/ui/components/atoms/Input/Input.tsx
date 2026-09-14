import type { InputHTMLAttributes } from 'react';

import './Input.css';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  readonly valor: string;
  readonly onCambio: (valor: string) => void;
  /** Required: an input with no accessible name is an input nobody can describe out loud. */
  readonly etiqueta: string;
  /** Rendered above the field. Omit when the label is carried by a surrounding row. */
  readonly mostrarEtiqueta?: boolean;
  readonly ayuda?: string;
}

/** Presentational. */
export function Input({
  valor,
  onCambio,
  etiqueta,
  mostrarEtiqueta = false,
  ayuda,
  className,
  ...resto
}: InputProps) {
  const campo = (
    <input
      className={['input', className].filter(Boolean).join(' ')}
      value={valor}
      aria-label={mostrarEtiqueta ? undefined : etiqueta}
      onChange={(e) => onCambio(e.target.value)}
      {...resto}
    />
  );

  if (!mostrarEtiqueta) return campo;

  return (
    <label className="input-campo">
      <span className="input-campo__etiqueta">{etiqueta}</span>
      {campo}
      {ayuda && <span className="input-campo__ayuda">{ayuda}</span>}
    </label>
  );
}
