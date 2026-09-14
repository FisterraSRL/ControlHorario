import type { Motivo } from '../../domain/fichadas/index.js';
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

function esParametros(valor: unknown): valor is ParametrosConfiguracion {
  return (
    esObjeto(valor) &&
    typeof valor['descansoMaxMin'] === 'number' &&
    typeof valor['toleranciaMin'] === 'number' &&
    typeof valor['horasTurnoSemanales'] === 'number'
  );
}

function esReglas(valor: unknown): valor is Record<string, number> {
  return esObjeto(valor) && Object.values(valor).every((v) => typeof v === 'number');
}

export function crearRepositorioConfiguracionHttp(base: string): RepositorioConfiguracion {
  const raiz = `${base}/configuracion`;

  return {
    async leer() {
      const cuerpo = await pedirJson(raiz, { method: 'GET' });
      if (
        !esObjeto(cuerpo) ||
        !esParametros(cuerpo['parametros']) ||
        !esReglas(cuerpo['reglasSector']) ||
        !Array.isArray(cuerpo['motivos']) ||
        !Array.isArray(cuerpo['exclusiones'])
      ) {
        throw new Error(FORMATO_INESPERADO);
      }
      const configuracion: ConfiguracionGuardada = {
        parametros: cuerpo['parametros'],
        reglasSector: cuerpo['reglasSector'],
        motivos: cuerpo['motivos'].filter(esMotivo),
        exclusiones: cuerpo['exclusiones'].filter(esExclusion),
      };
      return configuracion;
    },

    async guardarParametros(cambios) {
      const cuerpo = await pedirJson(`${raiz}/parametros`, conJson('PATCH', cambios));
      if (!esObjeto(cuerpo) || !esParametros(cuerpo['parametros'])) {
        throw new Error(FORMATO_INESPERADO);
      }
      return cuerpo['parametros'];
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
