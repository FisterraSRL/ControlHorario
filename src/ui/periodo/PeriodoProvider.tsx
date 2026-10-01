/**
 * Container for the period state. It holds the mode and either its anchor or, for a range
 * picked on the calendar, its two ends; every screen reads the resulting range and decides
 * for itself whether it cares. Screens never see the difference: `rango` is a plain
 * `{ desde, hasta }` in every mode.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  cambiarModoPeriodo,
  crearRango,
  desplazarPeriodo,
  periodoInicial,
  rangoDelPeriodo,
  type ModoPreset,
  type Periodo,
  type RangoPeriodo,
} from './periodo.js';

interface ContextoPeriodo {
  readonly periodo: Periodo;
  readonly rango: RangoPeriodo;
  readonly cambiarModo: (modo: ModoPreset) => void;
  readonly desplazar: (direccion: 1 | -1) => void;
  /** Either order; the same day twice is a one-day range. */
  readonly fijarRango: (desde: Date, hasta: Date) => void;
}

const PeriodoContext = createContext<ContextoPeriodo | null>(null);

export function PeriodoProvider({ children }: { readonly children: ReactNode }) {
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);

  const cambiarModo = useCallback((modo: ModoPreset) => {
    // The anchor is kept: switching from week to month should show the month that contains
    // the week you were looking at, not jump back to today. `crearPeriodo` re-snaps it, so
    // coming back to `semana` from any other mode lands on a Monday again. From a range the
    // kept day is its `desde`.
    setPeriodo((actual) => cambiarModoPeriodo(actual, modo));
  }, []);

  const desplazar = useCallback((direccion: 1 | -1) => {
    setPeriodo((actual) => desplazarPeriodo(actual, direccion));
  }, []);

  const fijarRango = useCallback((desde: Date, hasta: Date) => {
    setPeriodo(crearRango(desde, hasta));
  }, []);

  const valor = useMemo<ContextoPeriodo>(
    () => ({ periodo, rango: rangoDelPeriodo(periodo), cambiarModo, desplazar, fijarRango }),
    [periodo, cambiarModo, desplazar, fijarRango],
  );

  return <PeriodoContext.Provider value={valor}>{children}</PeriodoContext.Provider>;
}

export function usePeriodo(): ContextoPeriodo {
  const ctx = useContext(PeriodoContext);
  if (!ctx) throw new Error('usePeriodo se usó fuera de <PeriodoProvider>.');
  return ctx;
}
