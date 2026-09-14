/**
 * The pending counts on the sidebar badges.
 *
 * Pure: day records in, three numbers out. Same definitions the legacy `render()` used, so
 * the badges keep meaning what the people reading them already think they mean.
 */

import { reporteSemanal, type ConfiguracionFichadas, type RegistroDia } from '../../domain/fichadas/index.js';
import { dentroDelPeriodo, type RangoPeriodo } from '../periodo/periodo.js';

export interface ContadoresNav {
  /** Every individual fault in the period, not the number of people who have one. */
  readonly faltas: number;
  /** Días de ausencia with no motivo. "Sin clasificar" is the absence of a motivo. */
  readonly ausenciasPendientes: number;
  /** Weeks in the Horas report that still contain an unclassified absence. */
  readonly semanasSinClasificar: number;
}

export const CONTADORES_VACIOS: ContadoresNav = {
  faltas: 0,
  ausenciasPendientes: 0,
  semanasSinClasificar: 0,
};

export function registrosDelPeriodo(
  registros: readonly RegistroDia[],
  rango: RangoPeriodo,
): readonly RegistroDia[] {
  return registros.filter((r) => dentroDelPeriodo(r.fecha, rango));
}

export function contarPendientes(
  registrosDelRango: readonly RegistroDia[],
  cfg: ConfiguracionFichadas,
): ContadoresNav {
  let faltas = 0;
  let ausenciasPendientes = 0;
  for (const r of registrosDelRango) {
    faltas += r.faltas.length;
    if (r.tipoDia === 'ausencia' && !r.motivoId) ausenciasPendientes++;
  }
  const semanasSinClasificar = reporteSemanal(registrosDelRango, cfg).filter(
    (semana) => semana.diasAusenciaSinClasificar > 0,
  ).length;

  return { faltas, ausenciasPendientes, semanasSinClasificar };
}
