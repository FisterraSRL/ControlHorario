import type { ReactNode } from 'react';

import './AppShell.css';

export interface AppShellProps {
  readonly sidebar: ReactNode;
  readonly topbar: ReactNode;
  readonly children: ReactNode;
}

/**
 * Presentational. The two-column chrome and nothing else: sidebar, sticky topbar, scrolling
 * content column.
 *
 * The legacy sidebar ended with the line "Los datos que cargás quedan solo en tu navegador —
 * nada se envía a un servidor." It is deliberately not reproduced. It was already untrue in
 * the artifact, which published the shared registry, and it will be less true still once the
 * historial moves to Postgres in slice 2c. There is no replacement claim here: a promise
 * about where payroll data goes is a promise this layer is in no position to make.
 */
export function AppShell({ sidebar, topbar, children }: AppShellProps) {
  return (
    <div className="shell">
      {sidebar}
      <div className="shell__main">
        {topbar}
        <main className="shell__content">{children}</main>
      </div>
    </div>
  );
}
