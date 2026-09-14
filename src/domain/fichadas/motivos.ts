/**
 * The closed list of motivos de ausencia, and the classification of QUICKPASS's own
 * "Partes" note into one of them.
 */

import { celdaTexto } from './parseo.js';
import type { Motivo, ValorCelda } from './tipos.js';

/**
 * QUICKPASS's own Partes/novedad note flags a forgotten punch as "Olvidó fichar (xN)".
 * It is both a selectable motivo de ausencia (counts as worked: the person was on shift,
 * they just failed to register it) AND, on its own, grounds for a Fichadas Incompletas
 * notification: the person ultimately never clocked in.
 */
export const RE_OLVIDO_FICHAR = /olvid[oó]\s+fichar/i;
export const ID_OLVIDO_FICHAR = 8;

export const RE_RECUPERA_HORAS = /recupera\s*horas/i;
export const ID_RECUPERA_HORAS = 9;

export const MOTIVOS_POR_DEFECTO: readonly Motivo[] = [
  { id: 1, label: 'Ausente sin Aviso', worked: false },
  { id: 2, label: 'Ausente con Aviso', worked: false },
  { id: 3, label: 'Suspensión', worked: false },
  { id: 4, label: 'Enfermedad', worked: true },
  { id: 5, label: 'Feriado', worked: true },
  { id: 6, label: 'Autorizado empresa', worked: true },
  { id: 7, label: 'Vacaciones', worked: true },
  { id: ID_OLVIDO_FICHAR, label: 'Olvidó fichar', worked: true },
  { id: ID_RECUPERA_HORAS, label: 'Recupera Horas', worked: false },
];

/** Sectors that only punch twice a day. Everything else requires 4 fichadas. */
export const SECTORES_2_FICHADAS: readonly string[] = ['Reparto', 'Cocina', 'Administración'];

/**
 * Note patterns, in priority order. THE ORDER IS PART OF THE RULE, not a formatting
 * detail: `Recupera Horas` is tested ahead of the looser `autorizado|compensa|trabaja
 * fuera` pattern so a real note combining both words ("Recupera Horas - Autorizado")
 * classifies as Recupera Horas (which does NOT count as worked) instead of Autorizado
 * empresa (which does). Reordering this array changes payroll.
 */
export const PARTES_MAP: readonly (readonly [RegExp, number])[] = [
  [RE_RECUPERA_HORAS, ID_RECUPERA_HORAS],
  [/ausente sin aviso/i, 1],
  [/ausente con aviso/i, 2],
  [/suspensi/i, 3],
  [/enfermedad|licencia enfermedad/i, 4],
  [/feriado/i, 5],
  [/autorizado|compensa|trabaja fuera/i, 6],
  [/vacacion/i, 7],
  [RE_OLVIDO_FICHAR, ID_OLVIDO_FICHAR],
];

/**
 * Maps a Partes note to a motivo id, or null when nothing matches. The first pattern that
 * matches wins — see `PARTES_MAP`.
 */
export function clasificarPartes(partesRaw: ValorCelda): number | null {
  const s = celdaTexto(partesRaw).trim();
  if (!s) return null;
  for (const [patron, motivoId] of PARTES_MAP) {
    if (patron.test(s)) return motivoId;
  }
  return null;
}

/** Index of `worked` by motivo id, used to decide whether an absence still pays. */
export function indiceMotivosTrabajados(
  motivos: readonly Motivo[] = MOTIVOS_POR_DEFECTO,
): Map<number, boolean> {
  const idx = new Map<number, boolean>();
  for (const m of motivos) idx.set(m.id, m.worked);
  return idx;
}
