/**
 * The load summary: what the operator gets back after uploading a QUICKPASS export.
 *
 * Pure. It reads the derived day records and the repository's own report of what it wrote,
 * and produces the numbers the screen prints. The legacy `renderCargaSummary` showed four
 * of them — personas, sectores, días en el historial, rango total — computed over the WHOLE
 * accumulated historial rather than over the file just uploaded, which is the useful figure:
 * it answers "what does the system know now", not "what was in that one file".
 */

import { fmtFechaAR, type RegistroDia } from '../../../domain/fichadas/index.js';
import type { ResultadoGuardado } from '../../historial/RepositorioFichadas.js';

export interface ResumenCarga {
  readonly archivo: string;
  readonly hoja: string;
  /** Rows in the uploaded file. */
  readonly filasEnArchivo: number;
  readonly columnasFaltantes: readonly string[];
  readonly guardado: ResultadoGuardado;

  // --- Over the whole accumulated historial, after the upload ---
  readonly personas: number;
  readonly sectores: number;
  readonly diasEnHistorial: number;
  readonly desde: Date | null;
  readonly hasta: Date | null;
  /** Stored days whose `Fecha` cell is not `DD/MM/YYYY` and therefore parses to nothing. */
  readonly diasSinFecha: number;
}

export interface DatosResumen {
  readonly archivo: string;
  readonly hoja: string;
  readonly filasEnArchivo: number;
  readonly columnasFaltantes: readonly string[];
  readonly guardado: ResultadoGuardado;
  readonly registros: readonly RegistroDia[];
}

export function resumirCarga(datos: DatosResumen): ResumenCarga {
  const personas = new Set<string>();
  const sectores = new Set<string>();
  let desde: Date | null = null;
  let hasta: Date | null = null;
  let diasSinFecha = 0;

  for (const r of datos.registros) {
    if (r.dni) personas.add(r.dni);
    if (r.sector) sectores.add(r.sector);
    if (r.fecha) {
      if (!desde || r.fecha < desde) desde = r.fecha;
      if (!hasta || r.fecha > hasta) hasta = r.fecha;
    } else {
      diasSinFecha++;
    }
  }

  return {
    archivo: datos.archivo,
    hoja: datos.hoja,
    filasEnArchivo: datos.filasEnArchivo,
    columnasFaltantes: datos.columnasFaltantes,
    guardado: datos.guardado,
    personas: personas.size,
    sectores: sectores.size,
    diasEnHistorial: datos.registros.length,
    desde,
    hasta,
    diasSinFecha,
  };
}

/** `01/09/2026 – 14/09/2026`, or an em dash when the historial has no parseable date. */
export function etiquetaRangoHistorial(resumen: ResumenCarga): string {
  if (!resumen.desde || !resumen.hasta) return '—';
  if (resumen.desde.getTime() === resumen.hasta.getTime()) return fmtFechaAR(resumen.desde);
  return `${fmtFechaAR(resumen.desde)} – ${fmtFechaAR(resumen.hasta)}`;
}
