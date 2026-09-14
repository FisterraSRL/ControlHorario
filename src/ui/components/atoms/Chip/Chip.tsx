import type { ReactNode } from 'react';

import './Chip.css';

/**
 * The three fault types keep the colours the legacy file gave them — incompleta amber,
 * descanso blue, tardanza red — because those same colours are printed into the Word
 * notifications, and the screen and the letter have to read as the same document.
 */
export type TonoChip = 'incompleta' | 'descanso' | 'tardanza' | 'ok' | 'neutral';

export interface ChipProps {
  readonly tono?: TonoChip;
  readonly children: ReactNode;
  readonly title?: string;
}

/** Presentational. */
export function Chip({ tono = 'neutral', children, title }: ChipProps) {
  return (
    <span className={`chip chip--${tono}`} title={title}>
      {children}
    </span>
  );
}
