/**
 * The persistence boundary.
 *
 * `RepositorioFichadas` is a port: the screens know this interface and nothing else about
 * where the historial lives. Today the only adapter is `repositorioLocal.ts`
 * (localStorage, with an in-memory fallback). Slice 2c adds a Postgres-backed adapter
 * behind this same interface and no screen changes.
 *
 * It deliberately does NOT live in `src/domain`. The domain is pure rules over data handed
 * to it; the moment it knows about a repository it knows about I/O, and it stops being
 * testable without one.
 *
 * What is stored is the **raw QUICKPASS row, verbatim**. Nothing derived is persisted:
 * faults, día type and motivos are recomputed from the evidence on every read, which is
 * what makes a rule fix retroactive (README, decisions 6 and 7).
 *
 * Everything is async even though localStorage is not. The Postgres adapter will be over
 * HTTP, and a synchronous port would have to be rewritten — along with every caller — the
 * day it arrives.
 */

import type { FilaQuickpass } from '../../domain/fichadas/index.js';

/** `${DNI}|${Fecha}` built from the raw cells, exactly as the legacy historial keyed them. */
export type ClaveFichada = string;

export function claveFichada(dni: string, fecha: string): ClaveFichada {
  return `${dni}|${fecha}`;
}

/**
 * Reads the two key cells off a raw row. A row missing either one cannot be attributed to a
 * person on a day and is not storable evidence.
 */
export function claveDeFila(fila: FilaQuickpass): ClaveFichada | null {
  const dni = fila['DNI'] ? String(fila['DNI']) : '';
  const fecha = fila['Fecha'] ? String(fila['Fecha']) : '';
  if (!dni || !fecha) return null;
  return claveFichada(dni, fecha);
}

export interface ResultadoGuardado {
  /** Rows handed to `upsert`. */
  readonly recibidas: number;
  /** Rows dropped for having no DNI or no Fecha. */
  readonly descartadas: number;
  /** Keys that were not in the historial before. */
  readonly nuevas: number;
  /** Keys that were already there and whose content changed. */
  readonly actualizadas: number;
  /** Keys already there whose content was byte-identical. */
  readonly sinCambios: number;
  /** Size of the whole accumulated historial afterwards. */
  readonly totalHistorial: number;
}

export interface RepositorioFichadas {
  /** The whole accumulated historial: every period ever uploaded, in insertion order. */
  listar(): Promise<readonly FilaQuickpass[]>;
  /**
   * Upserts rows keyed by `DNI|Fecha`. Re-uploading a period overwrites its rows with the
   * newer copy; every other period already stored is untouched.
   */
  upsert(filas: readonly FilaQuickpass[]): Promise<ResultadoGuardado>;
  /** Drops the whole historial. Only the operator asks for this. */
  vaciar(): Promise<void>;
}

/** Thrown when the adapter cannot read or write. The UI shows it; it is never swallowed. */
export class ErrorRepositorio extends Error {
  override readonly name = 'ErrorRepositorio';
}
