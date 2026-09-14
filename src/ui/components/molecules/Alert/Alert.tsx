import type { ReactNode } from 'react';

import './Alert.css';

export type TonoAlerta = 'error' | 'aviso' | 'info' | 'ok';

export interface AlertProps {
  readonly tono: TonoAlerta;
  readonly titulo?: string;
  readonly children: ReactNode;
}

/**
 * Presentational. Errors belong on the screen the operator is looking at, not in a console
 * they will never open — so an error tone is announced assertively, the rest politely.
 */
export function Alert({ tono, titulo, children }: AlertProps) {
  return (
    <div
      className={`alert alert--${tono}`}
      role={tono === 'error' ? 'alert' : 'status'}
      aria-live={tono === 'error' ? 'assertive' : 'polite'}
    >
      <div className="alert__cuerpo">
        {titulo && <strong className="alert__titulo">{titulo}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}
