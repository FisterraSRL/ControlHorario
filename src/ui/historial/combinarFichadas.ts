import type { FilaQuickpass } from '../../domain/fichadas/index.js';
import { claveDeFila, type ResultadoGuardado } from './RepositorioFichadas.js';

/** Shared, side-effect-free local upsert; callers decide whether to persist the result. */
export function combinarFichadas(anteriores: Readonly<Record<string, FilaQuickpass>>, filas: readonly FilaQuickpass[]) {
  const mapa = { ...anteriores };
  let nuevas = 0, actualizadas = 0, sinCambios = 0, descartadas = 0;
  for (const fila of filas) {
    const clave = claveDeFila(fila);
    if (!clave) { descartadas++; continue; }
    const previa = mapa[clave];
    if (!previa) { mapa[clave] = fila; nuevas++; }
    else if (JSON.stringify(previa) !== JSON.stringify(fila)) { mapa[clave] = fila; actualizadas++; }
    else sinCambios++;
  }
  const resultado: ResultadoGuardado = { recibidas: filas.length, descartadas, nuevas, actualizadas, sinCambios, totalHistorial: Object.keys(mapa).length };
  return { mapa, resultado };
}
