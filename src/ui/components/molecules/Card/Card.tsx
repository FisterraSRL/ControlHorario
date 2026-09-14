import type { ReactNode } from 'react';

import './Card.css';

export interface CardProps {
  readonly titulo?: string;
  /** The one-line explanation under the title. Prose, not a label. */
  readonly bajada?: ReactNode;
  readonly acciones?: ReactNode;
  readonly children?: ReactNode;
}

/** Presentational. The panel every screen is built out of. */
export function Card({ titulo, bajada, acciones, children }: CardProps) {
  return (
    <section className="card">
      {(titulo || acciones) && (
        <header className="card__head">
          <div className="card__headings">
            {titulo && <h2 className="card__title">{titulo}</h2>}
            {bajada && <p className="card__sub">{bajada}</p>}
          </div>
          {acciones && <div className="card__acciones">{acciones}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
