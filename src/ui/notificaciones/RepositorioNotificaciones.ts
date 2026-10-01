/**
 * The "already notified" boundary.
 *
 * Generating a Word is what marks the faltas it covers as notified: the screen records the
 * keys through this port and only then hands the file over. There is no manual mark and no
 * way to un-notify. A key is `(dni, fechaIso, tipo)` exactly as `clavesNotificadas` in
 * `src/ui/faltas/porDia.ts` builds it — that function is the one definition of what a
 * document covers, and this port never re-derives it.
 *
 * `fecha` here is always `YYYY-MM-DD`, because that is what the server's `date` column
 * answers; the QUICKPASS `DD/MM/YYYY` cell never crosses this boundary.
 */

import type { TipoFalta } from '../../domain/fichadas/index.js';
import type { ClaveNotificada } from '../faltas/porDia.js';

/** One recorded notification. */
export interface FaltaNotificada {
  readonly dni: string;
  /** `YYYY-MM-DD`. */
  readonly fecha: string;
  readonly tipo: TipoFalta;
  /** ISO timestamp of the FIRST document that covered this falta. */
  readonly notificadoAt: string;
}

/**
 * The most keys one request may carry. Mirrors `MAX_FALTAS_POR_NOTIFICACION` in
 * `src/api/esquemas.ts`; the HTTP adapter splits anything larger into several requests.
 */
export const MAX_FALTAS_POR_REGISTRO = 5000;

/**
 * The widest window one read may ask for, in days, both ends included. Mirrors
 * `MAX_DIAS_VENTANA_NOTIFICADAS` in `src/api/esquemas.ts`; a longer period picked on the
 * calendar is read as several consecutive windows.
 */
export const MAX_DIAS_POR_CONSULTA = 400;

export interface RepositorioNotificaciones {
  /** Every recorded notification whose day is inside `[desdeIso, hastaIso]`. */
  listar(desdeIso: string, hastaIso: string): Promise<readonly FaltaNotificada[]>;
  /**
   * Records that a document covering `claves` was generated. Idempotent: a key already on
   * record keeps its first timestamp. Resolves only when every key is on record.
   */
  registrar(claves: readonly ClaveNotificada[]): Promise<void>;
}

const MS_POR_DIA = 86_400_000;

function aFecha(iso: string): Date {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(Date.UTC(anio ?? 0, (mes ?? 1) - 1, dia ?? 1));
}

/**
 * `[desdeIso, hastaIso]` cut into consecutive windows of at most `maxDias` days, in order,
 * without gaps or overlaps. A window the server would accept is returned as is. Pure, so the
 * splitting can be tested without a network.
 */
export function ventanasDeConsulta(
  desdeIso: string,
  hastaIso: string,
  maxDias: number = MAX_DIAS_POR_CONSULTA,
): readonly { readonly desde: string; readonly hasta: string }[] {
  const fin = aFecha(hastaIso).getTime();
  const ventanas: { desde: string; hasta: string }[] = [];
  for (let inicio = aFecha(desdeIso).getTime(); inicio <= fin; inicio += maxDias * MS_POR_DIA) {
    const hasta = Math.min(inicio + (maxDias - 1) * MS_POR_DIA, fin);
    ventanas.push({
      desde: new Date(inicio).toISOString().slice(0, 10),
      hasta: new Date(hasta).toISOString().slice(0, 10),
    });
  }
  return ventanas;
}

/** `items` in consecutive slices of at most `tamano`. */
export function enLotes<T>(items: readonly T[], tamano: number): readonly (readonly T[])[] {
  const lotes: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}
