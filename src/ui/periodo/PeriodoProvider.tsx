/**
 * Container for the period state. It holds the anchor and the mode; every screen reads the
 * resulting range and decides for itself whether it cares.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  desplazarPeriodo,
  periodoInicial,
  rangoDelPeriodo,
  type ModoPeriodo,
  type Periodo,
  type RangoPeriodo,
} from './periodo.js';

interface ContextoPeriodo {
  readonly periodo: Periodo;
  readonly rango: RangoPeriodo;
  readonly cambiarModo: (modo: ModoPeriodo) => void;
  readonly desplazar: (direccion: 1 | -1) => void;
}

const PeriodoContext = createContext<ContextoPeriodo | null>(null);

export function PeriodoProvider({ children }: { readonly children: ReactNode }) {
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);

  const cambiarModo = useCallback((modo: ModoPeriodo) => {
    // The anchor is kept: switching from week to month should show the month that contains
    // the week you were looking at, not jump back to today.
    setPeriodo((actual) => ({ modo, ancla: actual.ancla }));
  }, []);

  const desplazar = useCallback((direccion: 1 | -1) => {
    setPeriodo((actual) => desplazarPeriodo(actual, direccion));
  }, []);

  const valor = useMemo<ContextoPeriodo>(
    () => ({ periodo, rango: rangoDelPeriodo(periodo), cambiarModo, desplazar }),
    [periodo, cambiarModo, desplazar],
  );

  return <PeriodoContext.Provider value={valor}>{children}</PeriodoContext.Provider>;
}

export function usePeriodo(): ContextoPeriodo {
  const ctx = useContext(PeriodoContext);
  if (!ctx) throw new Error('usePeriodo se usó fuera de <PeriodoProvider>.');
  return ctx;
}
