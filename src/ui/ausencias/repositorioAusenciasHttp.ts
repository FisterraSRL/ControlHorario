import { conJson, esObjeto, pedirJson } from '../http.js';
import type { AusenciaRegistrada, RepositorioAusencias } from './RepositorioAusencias.js';

function esAusencia(valor: unknown): valor is AusenciaRegistrada {
  return (
    esObjeto(valor) &&
    typeof valor['dni'] === 'string' &&
    typeof valor['fecha'] === 'string' &&
    typeof valor['adjuntos'] === 'number'
  );
}

export function crearRepositorioAusenciasHttp(base: string): RepositorioAusencias {
  const raiz = `${base}/ausencias`;

  return {
    async listar() {
      const cuerpo = await pedirJson(raiz, { method: 'GET' });
      if (!esObjeto(cuerpo) || !Array.isArray(cuerpo['ausencias'])) {
        throw new Error(
          'El servidor devolvió el registro de ausencias en un formato inesperado. Puede que ' +
            'la aplicación y el servidor no estén en la misma versión: recargá la página.',
        );
      }
      return cuerpo['ausencias'].filter(esAusencia);
    },

    async asignarMotivo(dni, fechaStr, motivoId) {
      const cuerpo = await pedirJson(
        `${raiz}/motivo`,
        conJson('PUT', { dni, fecha: fechaStr, motivoId }),
      );
      if (!esObjeto(cuerpo) || !esAusencia(cuerpo['ausencia'])) {
        throw new Error(
          'El motivo se envió pero el servidor no informó cómo quedó el día. Recargá la ' +
            'página antes de volver a intentarlo.',
        );
      }
      return cuerpo['ausencia'];
    },

    async asignarMotivos(dias, motivoId) {
      const cuerpo = await pedirJson(
        `${raiz}/motivos`,
        conJson('PUT', {
          dias: dias.map((d) => ({ dni: d.dni, fecha: d.fechaStr })),
          motivoId,
        }),
      );
      // All or nothing, on the way back too: a row the guard drops would be a day the screen
      // keeps showing with its old motivo while the server already holds the new one.
      if (
        !esObjeto(cuerpo) ||
        !Array.isArray(cuerpo['ausencias']) ||
        !cuerpo['ausencias'].every(esAusencia)
      ) {
        throw new Error(
          'Los motivos se enviaron pero el servidor no informó cómo quedaron los días. ' +
            'Recargá la página antes de volver a intentarlo.',
        );
      }
      return cuerpo['ausencias'];
    },
  };
}
