import type { ReactNode } from 'react';

import './Stat.css';

export interface StatProps {
  readonly etiqueta: string;
  readonly valor: string | number;
  /** Optional second line, for a unit or a qualifier. */
  readonly nota?: string;
}

/** Presentational. One figure in the load summary. */
export function Stat({ etiqueta, valor, nota }: StatProps) {
  return (
    <div className="stat">
      <b className="stat__valor">{valor}</b>
      <span className="stat__etiqueta">{etiqueta}</span>
      {nota && <span className="stat__nota">{nota}</span>}
    </div>
  );
}

/** The responsive grid the stats sit in. */
export function StatGrid({ children }: { readonly children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}
