import type { ReactNode } from 'react';

import './Table.css';

/**
 * Presentational. The scroll container every table on these screens sits in.
 *
 * The horizontal scroll is on this wrapper and never on the page: a table of fichadas is
 * wide, and a page that scrolls sideways moves the sidebar and the period control out of
 * view along with it. Because of that, the vertical scroll is here too: a sticky header
 * can only stick inside its scroll container, so the wrapper has a max-height.
 */
export function Table({ children, etiqueta }: { readonly children: ReactNode; readonly etiqueta: string }) {
  return (
    <div className="tabla-envoltorio">
      <table className="tabla" aria-label={etiqueta}>
        {children}
      </table>
    </div>
  );
}

/** The row shown instead of a body when there is nothing to list. */
export function FilaVacia({ columnas, children }: { readonly columnas: number; readonly children: ReactNode }) {
  return (
    <tr>
      <td className="tabla__vacio" colSpan={columnas}>
        {children}
      </td>
    </tr>
  );
}
