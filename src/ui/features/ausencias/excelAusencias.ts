import { fmtFechaISO, parsearFechaDMY, type FilaQuickpass, type Motivo } from '../../../domain/fichadas/index.js';
import { claveRegistro, type AusenciaRegistrada } from '../../ausencias/RepositorioAusencias.js';
import { dentroDelPeriodo, type RangoPeriodo } from '../../periodo/periodo.js';

export interface DatosExcelAusencias {
  readonly columnas: readonly string[];
  readonly filas: readonly FilaQuickpass[];
}

/** Export the stored evidence, not the filtered absence queue or engine-derived records. */
export function prepararExcelAusencias(
  filas: readonly FilaQuickpass[], ausencias: readonly AusenciaRegistrada[],
  motivos: readonly Motivo[], rango: RangoPeriodo,
): DatosExcelAusencias {
  const periodo = filas.filter((fila) => dentroDelPeriodo(parsearFechaDMY(fila.Fecha), rango));
  if (periodo.length === 0) throw new Error('No hay filas importadas en el período seleccionado.');
  const columnas = [...new Set(periodo.flatMap((fila) => Object.keys(fila)))];
  const columnasPartes = columnas.filter((columna) => columna.trim().toLowerCase() === 'partes');
  if (columnasPartes.length === 0) { columnas.push('Partes'); columnasPartes.push('Partes'); }
  const porClave = new Map(ausencias.map((ausencia) => [claveRegistro(ausencia.dni, ausencia.fecha), ausencia]));
  const etiquetas = new Map(motivos.map((motivo) => [motivo.id, motivo.label]));
  return { columnas, filas: periodo.map((fila) => {
    const fecha = parsearFechaDMY(fila.Fecha)!;
    const ausencia = porClave.get(claveRegistro(String(fila.DNI ?? ''), fmtFechaISO(fecha)));
    const copia = { ...fila };
    if (ausencia?.motivoId != null && (ausencia.motivoSource === 'manual' || ausencia.motivoSource === 'encargado')) {
      const label = etiquetas.get(ausencia.motivoId) ?? ausencia.motivoLabel;
      if (!label?.trim()) throw new Error('No se pudo leer el nombre de un motivo guardado. Recargá la página y volvé a descargar el Excel.');
      for (const columna of columnasPartes) copia[columna] = label;
    }
    return copia;
  }) };
}

/** Spreadsheet serialization stays outside the screen. */
export async function generarExcelAusencias(datos: DatosExcelAusencias, rango: RangoPeriodo) {
  const { utils, write } = await import('xlsx');
  const libro = utils.book_new();
  const hoja = utils.aoa_to_sheet([
    [...datos.columnas],
    ...datos.filas.map((fila) => datos.columnas.map((columna) => fila[columna] ?? '')),
  ]);
  utils.book_append_sheet(libro, hoja, 'QUICKPASS');
  const bytes = new Uint8Array(write(libro, { type: 'array', bookType: 'xlsx', compression: true }));
  return { bytes, nombre: `quickpass_con_motivos_${fmtFechaISO(rango.desde)}_${fmtFechaISO(rango.hasta)}.xlsx` };
}
