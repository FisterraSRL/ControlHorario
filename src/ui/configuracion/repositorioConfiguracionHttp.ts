import { TARDANZAS_PERDONADAS_POR_DEFECTO, type Motivo } from '../../domain/fichadas/index.js';
import { conJson, esObjeto, pedir, pedirJson } from '../http.js';
import type {
  ConfiguracionGuardada,
  Exclusion,
  ParametrosConfiguracion,
  RepositorioConfiguracion,
} from './RepositorioConfiguracion.js';

const FORMATO_INESPERADO =
  'El servidor devolvió la configuración en un formato inesperado. Puede que la aplicación y ' +
  'el servidor no estén en la misma versión: recargá la página.';

function esMotivo(valor: unknown): valor is Motivo {
  return (
    esObjeto(valor) &&
    typeof valor['id'] === 'number' &&
    typeof valor['label'] === 'string' &&
    typeof valor['worked'] === 'boolean'
  );
}

function esExclusion(valor: unknown): valor is Exclusion {
  return esObjeto(valor) && typeof valor['dni'] === 'string';
}

/**
 * The parameters as the server sent them, or null when they are not usable.
 *
 * `tardanzasPerdonadasSemana` is read LENIENTLY: absent means the default. Vercel publishes
 * the frontend on every push to `main`, while the API is deployed by hand afterwards, so for
 * a while a new screen talks to an API that does not know the field yet. Rejecting the whole
 * body for it would leave Configuración, and every screen the engine feeds, without a
 * configuration. A value that IS present must still be a number.
 */
export function leerParametros(valor: unknown): ParametrosConfiguracion | null {
  if (
    !esObjeto(valor) ||
    typeof valor['descansoMaxMin'] !== 'number' ||
    typeof valor['toleranciaMin'] !== 'number' ||
    typeof valor['horasTurnoSemanales'] !== 'number'
  ) {
    return null;
  }
  const perdonadas = valor['tardanzasPerdonadasSemana'];
  if (perdonadas !== undefined && typeof perdonadas !== 'number') return null;
  return {
    descansoMaxMin: valor['descansoMaxMin'],
    toleranciaMin: valor['toleranciaMin'],
    horasTurnoSemanales: valor['horasTurnoSemanales'],
    tardanzasPerdonadasSemana: perdonadas ?? TARDANZAS_PERDONADAS_POR_DEFECTO,
  };
}

function esReglas(valor: unknown): valor is Record<string, number> {
  return esObjeto(valor) && Object.values(valor).every((v) => typeof v === 'number');
}

export function crearRepositorioConfiguracionHttp(base: string): RepositorioConfiguracion {
  const raiz = `${base}/configuracion`;

  return {
    async leer() {
      const cuerpo = await pedirJson(raiz, { method: 'GET' });
      const parametros = esObjeto(cuerpo) ? leerParametros(cuerpo['parametros']) : null;
      if (
        !esObjeto(cuerpo) ||
        !parametros ||
        !esReglas(cuerpo['reglasSector']) ||
        !Array.isArray(cuerpo['motivos']) ||
        !Array.isArray(cuerpo['exclusiones'])
      ) {
        throw new Error(FORMATO_INESPERADO);
      }
      const configuracion: ConfiguracionGuardada = {
        parametros,
        reglasSector: cuerpo['reglasSector'],
        motivos: cuerpo['motivos'].filter(esMotivo),
        exclusiones: cuerpo['exclusiones'].filter(esExclusion),
      };
      return configuracion;
    },

    async guardarParametros(cambios) {
      const cuerpo = await pedirJson(`${raiz}/parametros`, conJson('PATCH', cambios));
      const parametros = esObjeto(cuerpo) ? leerParametros(cuerpo['parametros']) : null;
      if (!parametros) throw new Error(FORMATO_INESPERADO);
      return parametros;
    },

    async guardarReglaSector(sector, fichadasRequeridas) {
      const cuerpo = await pedirJson(
        `${raiz}/sectores`,
        conJson('PUT', { sector, fichadasRequeridas }),
      );
      if (!esObjeto(cuerpo) || !esReglas(cuerpo['reglasSector'])) {
        throw new Error(FORMATO_INESPERADO);
      }
      return cuerpo['reglasSector'];
    },

    async crearMotivo(label, worked) {
      const cuerpo = await pedirJson(`${raiz}/motivos`, conJson('POST', { label, worked }));
      if (!esObjeto(cuerpo) || !esMotivo(cuerpo['motivo'])) throw new Error(FORMATO_INESPERADO);
      return cuerpo['motivo'];
    },

    async editarMotivo(id, worked) {
      const cuerpo = await pedirJson(`${raiz}/motivos/${id}`, conJson('PATCH', { worked }));
      if (!esObjeto(cuerpo) || !esMotivo(cuerpo['motivo'])) throw new Error(FORMATO_INESPERADO);
      return cuerpo['motivo'];
    },

    async retirarMotivo(id) {
      await pedir(`${raiz}/motivos/${id}`, { method: 'DELETE' });
    },

    async agregarExclusion(dni, motivoTexto) {
      const cuerpo = await pedirJson(
        `${raiz}/exclusiones`,
        conJson('POST', motivoTexto === null ? { dni } : { dni, motivoTexto }),
      );
      if (!esObjeto(cuerpo) || !esExclusion(cuerpo['exclusion'])) {
        throw new Error(FORMATO_INESPERADO);
      }
      return cuerpo['exclusion'];
    },

    async quitarExclusion(dni) {
      // A body on a DELETE rather than the DNI in the path: a path is written into the
      // request log and into the browser's history, and a DNI is personal data. See the
      // header of src/api/rutasAusencias.ts.
      await pedir(`${raiz}/exclusiones`, conJson('DELETE', { dni }));
    },
  };
}
