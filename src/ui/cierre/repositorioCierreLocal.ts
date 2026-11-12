import {
  claveIrregularidad, DIA_CORTE_PREDETERMINADO, esDiaCorte, type RevisionIrregularidad,
} from '../../domain/cierre.js';
import { esRevision, type RepositorioCierre } from './RepositorioCierre.js';

const CORTE = 'controlhorario.cierre.corte.v1';
const REVISIONES = 'controlhorario.cierre.revisiones.v1';

export function crearRepositorioCierreLocal(
  storage: () => Storage = () => globalThis.localStorage,
): RepositorioCierre & { vaciarRevisiones(): void } {
  function leerRevisiones(): RevisionIrregularidad[] {
    const datos: unknown = JSON.parse(storage().getItem(REVISIONES) ?? '[]');
    if (!Array.isArray(datos) || !datos.every(esRevision)) {
      throw new Error('Las revisiones guardadas en este navegador no se pudieron leer.');
    }
    return datos;
  }
  return {
    async leerCorte() {
      const dia = Number(storage().getItem(CORTE) ?? DIA_CORTE_PREDETERMINADO);
      return esDiaCorte(dia) ? dia : DIA_CORTE_PREDETERMINADO;
    },
    async guardarCorte(dia) {
      storage().setItem(CORTE, String(dia));
    },
    async listar(desde, hasta) {
      return leerRevisiones().filter(({ fecha }) => fecha >= desde && fecha <= hasta);
    },
    async decidir(clave, decision) {
      const id = claveIrregularidad(clave);
      const revisiones = leerRevisiones().filter((revision) => claveIrregularidad(revision) !== id);
      if (decision) revisiones.push({ ...clave, ...decision });
      storage().setItem(REVISIONES, JSON.stringify(revisiones));
    },
    vaciarRevisiones() {
      storage().removeItem(REVISIONES);
    },
  };
}
