/**
 * The engine configuration the app runs with.
 *
 * In this slice it is a constant: the Configuración screen is not built yet, so nobody can
 * change it. The values are the legacy defaults, and the shape is the domain's own
 * `ConfiguracionFichadas`, so wiring the screen later is a matter of replacing this
 * function with a stored, editable value — no caller changes.
 *
 * Two things deliberately stay empty here:
 *
 *   `dniExcluidos` — the list of people exempt from disciplinary notifications. It is
 *   personal data and it is seeded by the operator at runtime, never from source
 *   (README, Privacy; `exclusiones` in db/migrations/001_initial.sql).
 *
 *   `ausencias` — the human decisions over each (dni, fecha). They are a separate record
 *   from the evidence and they arrive in slice 2b.
 */

import {
  MOTIVOS_POR_DEFECTO,
  SECTORES_2_FICHADAS,
  type ConfiguracionFichadas,
} from '../../../domain/fichadas/index.js';

/** Sectors that punch twice a day; everything else requires the default four. */
function reglasSectorPorDefecto(): Record<string, number> {
  const reglas: Record<string, number> = {};
  for (const sector of SECTORES_2_FICHADAS) reglas[sector] = 2;
  return reglas;
}

export function configuracionPorDefecto(): ConfiguracionFichadas {
  return {
    reglasSector: reglasSectorPorDefecto(),
    motivos: MOTIVOS_POR_DEFECTO,
    descansoMaxMin: 30,
    toleranciaMin: 0,
    horasTurnoSemanales: 51,
  };
}
