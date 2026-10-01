/**
 * The closed list of motivos de ausencia, and the classification of QUICKPASS's own
 * "Partes" note into one of them — by fixed pattern first, then by motivo label.
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
 * Maps a Partes note to a motivo id, or null when nothing matches.
 *
 * TWO PASSES, AND THE ORDER IS THE RULE:
 *
 *   1. The fixed `PARTES_MAP` patterns, first match wins. They encode payroll decisions
 *      (see the comment on the map) and a label must never be able to override them.
 *   2. Only when none of them matched: the labels of `motivos`, so a motivo created in
 *      Configuración is recognised when the note names it. Containment is by whole word or
 *      phrase, ignoring case and accents — label "Paro" never matches "Parodi". When several
 *      labels are named, the longest one wins because it is the most specific ("Licencia por
 *      examen" over "Licencia"); a tie goes to the lowest id, so the answer never depends on
 *      the order of the list.
 *
 * `motivos` must be the ACTIVE motivos only. Both the server (`WHERE [activo] = 1`) and the
 * screen (which only ever receives those) pass that list, so a retired motivo is never
 * applied from a note. Without the argument the second pass does not run, which is exactly
 * the behaviour from before labels were matched.
 */
export function clasificarPartes(
  partesRaw: ValorCelda,
  motivos?: readonly Motivo[],
): number | null {
  const s = celdaTexto(partesRaw).trim();
  if (!s) return null;
  for (const [patron, motivoId] of PARTES_MAP) {
    if (patron.test(s)) return motivoId;
  }
  return motivos ? motivoPorEtiqueta(s, motivos) : null;
}

/** Lowercase, no diacritics, single spaces: the form both sides are compared in. */
function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const RE_LETRA_O_DIGITO = /[\p{L}\p{N}]/u;

/**
 * Whether `frase` occurs in `texto` with no letter or digit glued to either end. A plain
 * index scan and not a RegExp: the label is operator-typed text and is never compiled.
 */
function contieneFrase(texto: string, frase: string): boolean {
  let desde = 0;
  for (;;) {
    const i = texto.indexOf(frase, desde);
    if (i === -1) return false;
    const antes = i === 0 ? '' : texto.charAt(i - 1);
    const despues = texto.charAt(i + frase.length);
    if (!RE_LETRA_O_DIGITO.test(antes) && !RE_LETRA_O_DIGITO.test(despues)) return true;
    desde = i + 1;
  }
}

/** The second pass of `clasificarPartes`: the longest label the note names, lowest id on a tie. */
function motivoPorEtiqueta(nota: string, motivos: readonly Motivo[]): number | null {
  const texto = normalizarTexto(nota);
  let elegido: { readonly id: number; readonly largo: number } | null = null;
  for (const m of motivos) {
    const etiqueta = normalizarTexto(m.label);
    // A label that normalises to nothing would be "contained" in every note.
    if (!etiqueta || !contieneFrase(texto, etiqueta)) continue;
    if (
      !elegido ||
      etiqueta.length > elegido.largo ||
      (etiqueta.length === elegido.largo && m.id < elegido.id)
    ) {
      elegido = { id: m.id, largo: etiqueta.length };
    }
  }
  return elegido?.id ?? null;
}

/** Index of `worked` by motivo id, used to decide whether an absence still pays. */
export function indiceMotivosTrabajados(
  motivos: readonly Motivo[] = MOTIVOS_POR_DEFECTO,
): Map<number, boolean> {
  const idx = new Map<number, boolean>();
  for (const m of motivos) idx.set(m.id, m.worked);
  return idx;
}
