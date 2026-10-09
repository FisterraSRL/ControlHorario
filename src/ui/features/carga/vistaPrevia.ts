import { fmtFechaAR, parsearFechaDMY, type FilaQuickpass } from '../../../domain/fichadas/index.js';
import { claveDeFila } from '../../historial/RepositorioFichadas.js';
import { combinarFichadas } from '../../historial/combinarFichadas.js';
import type { PlanillaLeida } from './planilla.js';

export function prepararVistaPrevia(planilla: PlanillaLeida, historial: readonly FilaQuickpass[]) {
  const errores: string[] = [];
  const criticas = planilla.columnasFaltantes.filter(c => ['DNI', 'Fecha', 'Movimientos', 'Turno'].includes(c));
  if (criticas.length) errores.push(`Faltan columnas necesarias: ${criticas.join(', ')}. Volvé a exportar la planilla completa de QUICKPASS.`);
  const existentes = Object.fromEntries(historial.flatMap(f => { const k = claveDeFila(f); return k ? [[k, f]] : []; }));
  const unicas = new Map<string, FilaQuickpass>();
  const personas = new Set<string>();
  let repetidas = 0, invalidas = 0;
  let desde: Date | null = null, hasta: Date | null = null;
  planilla.filas.forEach((fila, indice) => {
    const numero = planilla.numerosFila?.[indice] ?? indice + 2;
    const dni = String(fila['DNI'] ?? '');
    const fechaTexto = String(fila['Fecha'] ?? '');
    const fecha = parsearFechaDMY(fechaTexto);
    const problemas: string[] = [];
    if (!dni.trim() || dni.length > 32 || dni !== dni.trim()) problemas.push('DNI vacío, con espacios en los extremos o mayor a 32 caracteres');
    if (!fecha || fmtFechaAR(fecha) !== fechaTexto || fecha.getUTCFullYear() < 100) problemas.push('Fecha inválida: usá un día real en DD/MM/AAAA');
    if (problemas.length) { invalidas++; errores.push(`Fila ${numero}: ${problemas.join('; ')}.`); return; }
    const clave = claveDeFila(fila)!;
    const previa = unicas.get(clave);
    if (previa) {
      if (JSON.stringify(previa) === JSON.stringify(fila)) repetidas++;
      else errores.push(`Fila ${numero}: hay dos versiones distintas para el mismo DNI y fecha. Dejá sólo la correcta.`);
      return;
    }
    unicas.set(clave, fila);
    personas.add(dni);
    if (!desde || fecha! < desde) desde = fecha;
    if (!hasta || fecha! > hasta) hasta = fecha;
    const almacenada = existentes[clave];
    const perdidas = planilla.columnasFaltantes.filter(c => almacenada && String(almacenada[c] ?? '') !== '');
    if (perdidas.length) errores.push(`Fila ${numero}: faltan columnas con datos ya guardados (${perdidas.join(', ')}). Importarla borraría esos datos.`);
  });
  if (!unicas.size) errores.push('No hay filas válidas para importar.');
  const filas = [...unicas.values()];
  return { planilla, filas, errores, invalidas, repetidas, personas: personas.size,
    periodo: desde && hasta ? `${fmtFechaAR(desde)} – ${fmtFechaAR(hasta)}` : 'Sin fechas válidas',
    estimado: combinarFichadas(existentes, filas).resultado };
}
export type VistaPrevia = ReturnType<typeof prepararVistaPrevia>;
