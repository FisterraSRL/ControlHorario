import { conJson, esObjeto, pedirJson } from '../http.js';
import {
  enLotes,
  MAX_FALTAS_POR_REGISTRO,
  ventanasDeConsulta,
  type FaltaNotificada,
  type RepositorioNotificaciones,
} from './RepositorioNotificaciones.js';

const TIPOS: ReadonlySet<unknown> = new Set(['incompleta', 'descanso', 'tardanza']);

function esNotificada(valor: unknown): valor is FaltaNotificada {
  return (
    esObjeto(valor) &&
    typeof valor['dni'] === 'string' &&
    typeof valor['fecha'] === 'string' &&
    TIPOS.has(valor['tipo']) &&
    typeof valor['notificadoAt'] === 'string'
  );
}

export function crearRepositorioNotificacionesHttp(base: string): RepositorioNotificaciones {
  const raiz = `${base}/notificaciones`;

  return {
    async listar(desdeIso, hastaIso) {
      const todas: FaltaNotificada[] = [];
      // A period longer than the server's window (a range picked by hand) is read in
      // consecutive windows; a preset period is always one request.
      for (const { desde, hasta } of ventanasDeConsulta(desdeIso, hastaIso)) {
        const consulta = new URLSearchParams({ desde, hasta });
        const cuerpo = await pedirJson(`${raiz}?${consulta.toString()}`, { method: 'GET' });
        if (!esObjeto(cuerpo) || !Array.isArray(cuerpo['notificadas'])) {
          throw new Error(
            'El servidor devolvió las notificaciones en un formato inesperado. Puede que la ' +
              'aplicación y el servidor no estén en la misma versión: recargá la página.',
          );
        }
        todas.push(...cuerpo['notificadas'].filter(esNotificada));
      }
      return todas;
    },

    async registrar(claves) {
      // Sequential, so a failure stops at the first refused slice. The slices already sent
      // stay recorded and the caller does not download: a record without its letter is the
      // safe side of that failure, and generating again only adds what was missing.
      for (const lote of enLotes(claves, MAX_FALTAS_POR_REGISTRO)) {
        const cuerpo = await pedirJson(
          raiz,
          conJson('POST', {
            faltas: lote.map((c) => ({ dni: c.dni, fecha: c.fechaIso, tipo: c.tipo })),
          }),
        );
        if (!esObjeto(cuerpo) || typeof cuerpo['registradas'] !== 'number') {
          throw new Error(
            'La notificación se envió pero el servidor no confirmó el registro. Recargá la ' +
              'página antes de volver a intentarlo.',
          );
        }
      }
    },
  };
}
