/**
 * Reading the QUICKPASS export.
 *
 * This is the only module in the app that knows a spreadsheet library exists. Everything
 * downstream sees `FilaQuickpass` — a plain record of column name to string — which is
 * exactly what the domain parsers expect.
 *
 * `raw: false` is not a preference. The engine's parsers (`parsearHM`, `parsearFechaDMY`,
 * `parsearMovimientos`) read the cell formats QUICKPASS prints — `"08:00 - 12:05"`,
 * `"14/09/2026"`, `"-1:30"`. With `raw: true` the reader hands back Excel serial numbers
 * and JavaScript Dates instead, every parser misses, and every day silently derives as
 * zero hours with no fichadas. `defval: ''` keeps the same absent-cell behaviour the
 * legacy file relied on, where a missing cell reads as the empty string rather than
 * disappearing from the row.
 */

import { read, utils } from 'xlsx';

import type { FilaQuickpass } from '../../../domain/fichadas/index.js';

/** An expected, explainable failure. Its message is written to be read by the operator. */
export class ErrorPlanilla extends Error {
  override readonly name = 'ErrorPlanilla';
}

/** Without these two there is no `DNI|Fecha` key, so the rows cannot be stored at all. */
export const COLUMNAS_REQUERIDAS: readonly string[] = ['DNI', 'Fecha'];

/** Every column the rules engine reads. A missing one degrades the derivation silently. */
export const COLUMNAS_ESPERADAS: readonly string[] = [
  'Sector',
  'Usuario',
  'DNI',
  'Legajo',
  'Fecha',
  'Movimientos',
  'Turno',
  'Horas Turno',
  'Horas',
  'Cantidad Tarde',
  'Partes',
];

const EXTENSIONES_ACEPTADAS: readonly string[] = ['.xlsx', '.xls'];

export interface PlanillaLeida {
  /** The uploaded file's own name, carried through so the summary can name it. */
  readonly archivo: string;
  readonly filas: readonly FilaQuickpass[];
  readonly hoja: string;
  /** Expected columns the sheet does not have. Not fatal; shown to the operator. */
  readonly columnasFaltantes: readonly string[];
}

function tieneExtensionValida(nombre: string): boolean {
  const bajo = nombre.toLowerCase();
  return EXTENSIONES_ACEPTADAS.some((ext) => bajo.endsWith(ext));
}

/** `.xlsx` is a ZIP (`PK\x03\x04`); a pre-2007 `.xls` is an OLE2 compound file. */
const FIRMAS: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0xd0, 0xcf, 0x11, 0xe0],
];

/**
 * Handed something that is not a spreadsheet, the reader does not fail: it guesses at the
 * bytes, finds nothing, and returns an empty sheet. The operator then gets "la hoja no
 * tiene filas" for a file that was never an Excel in the first place — which sends them
 * looking for the wrong problem. Checking the file signature first turns that into the
 * true message. It costs four bytes.
 */
function pareceExcel(bytes: Uint8Array): boolean {
  return FIRMAS.some((firma) => firma.every((b, i) => bytes[i] === b));
}

/**
 * Reads the first sheet of the workbook. The QUICKPASS export has exactly one, and the
 * legacy file took `SheetNames[0]` unconditionally — kept, so an export with a stray second
 * sheet behaves the same way it always has.
 */
export async function leerPlanilla(archivo: File): Promise<PlanillaLeida> {
  if (!tieneExtensionValida(archivo.name)) {
    throw new ErrorPlanilla(
      `"${archivo.name}" no es una planilla de Excel. Se esperaba un archivo .xlsx o .xls.`,
    );
  }

  let datos: ArrayBuffer;
  try {
    datos = await archivo.arrayBuffer();
  } catch {
    throw new ErrorPlanilla(
      'No se pudo leer el archivo desde el disco. Probá volver a seleccionarlo.',
    );
  }

  const bytes = new Uint8Array(datos);
  if (!pareceExcel(bytes)) {
    throw new ErrorPlanilla(
      `"${archivo.name}" tiene nombre de Excel pero su contenido no lo es. ` +
        'Suele pasar cuando se le cambió la extensión a un CSV o a un archivo de otro ' +
        'programa: abrilo en Excel y guardalo como .xlsx.',
    );
  }

  let libro;
  try {
    libro = read(bytes, { type: 'array', cellDates: false });
  } catch (e: unknown) {
    const detalle = e instanceof Error ? e.message : String(e);
    throw new ErrorPlanilla(
      `No se pudo abrir "${archivo.name}" como planilla de Excel. Puede estar dañado, ` +
        `protegido con contraseña o no ser realmente un Excel. Detalle: ${detalle}`,
    );
  }

  const hoja = libro.SheetNames[0];
  if (!hoja) throw new ErrorPlanilla(`"${archivo.name}" no tiene ninguna hoja.`);

  const worksheet = libro.Sheets[hoja];
  if (!worksheet) throw new ErrorPlanilla(`No se pudo leer la hoja "${hoja}".`);

  const filas = utils.sheet_to_json<FilaQuickpass>(worksheet, { defval: '', raw: false });

  if (filas.length === 0) {
    throw new ErrorPlanilla(
      `La hoja "${hoja}" no tiene ninguna fila de datos debajo de los encabezados.`,
    );
  }

  // With `defval: ''` every header column is a key on every row, so the first row is a
  // faithful list of the sheet's columns.
  const columnas = new Set(Object.keys(filas[0] as FilaQuickpass));

  const requeridasFaltantes = COLUMNAS_REQUERIDAS.filter((c) => !columnas.has(c));
  if (requeridasFaltantes.length > 0) {
    throw new ErrorPlanilla(
      `La hoja "${hoja}" no tiene ${requeridasFaltantes.map((c) => `"${c}"`).join(' ni ')}. ` +
        'Sin esas columnas no se puede identificar a quién y a qué día corresponde cada fila. ' +
        `Columnas encontradas: ${[...columnas].join(', ') || '(ninguna)'}.`,
    );
  }

  return {
    archivo: archivo.name,
    filas,
    hoja,
    columnasFaltantes: COLUMNAS_ESPERADAS.filter((c) => !columnas.has(c)),
  };
}
