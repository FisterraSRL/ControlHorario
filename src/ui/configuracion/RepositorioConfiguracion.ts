/**
 * The configuration boundary.
 *
 * Everything the Configuración screen edits, and everything the engine needs to run:
 * the per-sector fichada rule, the three thresholds, the closed list of motivos, and the
 * people excluded from disciplinary notifications.
 *
 * It is ONE port and one read on purpose. The four things are edited on one screen and used
 * together on every other one — the engine takes them as a single `ConfiguracionFichadas` —
 * so splitting them into four ports would mean four round trips and four chances for the
 * screen to render a half-updated configuration.
 *
 * `exclusiones` is DNI-keyed and never contains a name. The name shown next to it on screen
 * comes from the evidence, joined in the screen; see the comment on `exclusiones` in
 * db/migrations/001_initial.sql for why the list itself must not carry one.
 */

import type { Motivo } from '../../domain/fichadas/index.js';

export interface ParametrosConfiguracion {
  /** Maximum break in minutes before a `descanso` fault. The legacy `breakMax`. */
  readonly descansoMaxMin: number;
  /** Lateness tolerated in minutes before a `tardanza` fault. The legacy `tolerancia`. */
  readonly toleranciaMin: number;
  /** Contractual weekly hours, one global value. The legacy `horasTurnoFixed`. */
  readonly horasTurnoSemanales: number;
}

export interface Exclusion {
  readonly dni: string;
  readonly motivoTexto: string | null;
  readonly creadoPor: string | null;
  readonly creadoAt: string;
}

export interface ConfiguracionGuardada {
  readonly parametros: ParametrosConfiguracion;
  /** Sector -> fichadas required. A sector missing from here requires four. */
  readonly reglasSector: Readonly<Record<string, number>>;
  readonly motivos: readonly Motivo[];
  readonly exclusiones: readonly Exclusion[];
}

export interface RepositorioConfiguracion {
  leer(): Promise<ConfiguracionGuardada>;
  guardarParametros(cambios: Partial<ParametrosConfiguracion>): Promise<ParametrosConfiguracion>;
  guardarReglaSector(
    sector: string,
    fichadasRequeridas: number,
  ): Promise<Readonly<Record<string, number>>>;
  crearMotivo(label: string, worked: boolean): Promise<Motivo>;
  editarMotivo(id: number, worked: boolean): Promise<Motivo>;
  /**
   * Takes a motivo out of the dropdown.
   *
   * NOT a delete. `ausencias.motivo_id` and `respuestas.motivo_id` reference it with
   * ON DELETE RESTRICT: erasing a motivo would erase the meaning of every decision that
   * used it. The legacy screen removed it from an array and left that history pointing at
   * nothing.
   */
  retirarMotivo(id: number): Promise<void>;
  agregarExclusion(dni: string, motivoTexto: string | null): Promise<Exclusion>;
  quitarExclusion(dni: string): Promise<void>;
}
