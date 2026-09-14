import type { ButtonHTMLAttributes, ReactNode } from 'react';

import './Button.css';

export type VarianteBoton = 'neutral' | 'primary' | 'ghost';
export type TamanoBoton = 'md' | 'sm';

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variante?: VarianteBoton;
  readonly tamano?: TamanoBoton;
  readonly children?: ReactNode;
}

/**
 * Presentational. `type` defaults to `button`: a bare `<button>` inside a form submits it,
 * and every button in this app is an action, not a submit.
 */
export function Button({
  variante = 'neutral',
  tamano = 'md',
  className,
  type = 'button',
  children,
  ...resto
}: BotonProps) {
  const clases = ['btn', `btn--${variante}`, `btn--${tamano}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={clases} {...resto}>
      {children}
    </button>
  );
}
