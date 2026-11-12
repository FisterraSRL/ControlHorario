import { esDiaCorte, type RevisionIrregularidad } from '../../domain/cierre.js';
import { conJson, esObjeto, pedir, pedirJson } from '../http.js';
import { ventanasDeConsulta } from '../notificaciones/RepositorioNotificaciones.js';
import { esRevision, type RepositorioCierre } from './RepositorioCierre.js';

export function crearRepositorioCierreHttp(base: string): RepositorioCierre {
  const raiz = `${base}/cierre`;
  const revisiones = `${raiz}/irregularidades`;
  return {
    async leerCorte() {
      const datos = await pedirJson(`${raiz}/corte`);
      if (!esObjeto(datos) || !esDiaCorte(datos['dia'])) {
        throw new Error('El servidor devolvió un día de corte inválido.');
      }
      return datos['dia'];
    },
    async guardarCorte(dia) {
      await pedir(`${raiz}/corte`, conJson('PUT', { dia }));
    },
    async listar(desde, hasta) {
      const todas: RevisionIrregularidad[] = [];
      for (const ventana of ventanasDeConsulta(desde, hasta)) {
        const datos = await pedirJson(`${revisiones}?${new URLSearchParams(ventana)}`);
        if (!esObjeto(datos) || !Array.isArray(datos['revisiones']) || !datos['revisiones'].every(esRevision)) {
          throw new Error('El servidor devolvió revisiones en un formato inesperado.');
        }
        todas.push(...datos['revisiones']);
      }
      return todas;
    },
    async decidir(clave, decision) {
      const { dni, fecha, tipo } = clave;
      await pedir(revisiones, conJson('PUT', { dni, fecha, tipo, decision }));
    },
  };
}
