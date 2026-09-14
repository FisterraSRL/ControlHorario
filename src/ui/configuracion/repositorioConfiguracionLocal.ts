/**
 * The offline configuration: this browser's localStorage.
 *
 * It starts from exactly the values migration 002 seeds — the same three parameters, the
 * same three two-punch sectors, the same nine motivos out of the engine's own
 * `MOTIVOS_POR_DEFECTO` — so the offline path and the server path behave the same way on a
 * fresh install rather than merely looking similar.
 *
 * `exclusiones` starts EMPTY and is never seeded from source. That is the one rule this
 * whole area exists to enforce: the legacy file hardcoded six real employees by name, and
 * the list belongs to the operator's runtime, never to a file in git. Offline there is no
 * runtime to seed it from, so it is empty until somebody adds a DNI by hand.
 */

import { MOTIVOS_POR_DEFECTO, SECTORES_2_FICHADAS } from '../../domain/fichadas/index.js';
import type { Motivo } from '../../domain/fichadas/index.js';
import { ErrorRepositorio } from '../historial/RepositorioFichadas.js';
import type {
  ConfiguracionGuardada,
  Exclusion,
  ParametrosConfiguracion,
  RepositorioConfiguracion,
} from './RepositorioConfiguracion.js';

const CLAVE_ALMACEN = 'controlhorario.configuracion.v1';

function reglasPorDefecto(): Record<string, number> {
  const reglas: Record<string, number> = {};
  for (const sector of SECTORES_2_FICHADAS) reglas[sector] = 2;
  return reglas;
}

function configuracionInicial(): ConfiguracionGuardada {
  return {
    parametros: { descansoMaxMin: 30, toleranciaMin: 0, horasTurnoSemanales: 51 },
    reglasSector: reglasPorDefecto(),
    motivos: MOTIVOS_POR_DEFECTO.map((m) => ({ ...m })),
    exclusiones: [],
  };
}

function almacenDisponible(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const sonda = `${CLAVE_ALMACEN}.probe`;
    s.setItem(sonda, '1');
    s.removeItem(sonda);
    return s;
  } catch {
    return null;
  }
}

export function crearRepositorioConfiguracionLocal(
  storage: Storage | null = almacenDisponible(),
): RepositorioConfiguracion {
  let memoria: ConfiguracionGuardada = configuracionInicial();

  function leer(): ConfiguracionGuardada {
    if (!storage) return memoria;
    let crudo: string | null;
    try {
      crudo = storage.getItem(CLAVE_ALMACEN);
    } catch {
      return memoria;
    }
    if (!crudo) return configuracionInicial();
    try {
      const parseado: unknown = JSON.parse(crudo);
      if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
        return configuracionInicial();
      }
      // Merged over the defaults rather than trusted wholesale: a blob written by an older
      // version is missing whatever was added since, and a missing `descansoMaxMin` would
      // reach the engine as `undefined` minutes.
      return { ...configuracionInicial(), ...(parseado as Partial<ConfiguracionGuardada>) };
    } catch {
      throw new ErrorRepositorio(
        'La configuración guardada en este navegador no se pudo leer: el contenido está dañado.',
      );
    }
  }

  function escribir(cfg: ConfiguracionGuardada): void {
    memoria = cfg;
    if (!storage) return;
    try {
      storage.setItem(CLAVE_ALMACEN, JSON.stringify(cfg));
    } catch {
      throw new ErrorRepositorio('No se pudo guardar la configuración en este navegador.');
    }
  }

  return {
    async leer() {
      return leer();
    },

    async guardarParametros(cambios) {
      const cfg = leer();
      const parametros: ParametrosConfiguracion = { ...cfg.parametros, ...cambios };
      escribir({ ...cfg, parametros });
      return parametros;
    },

    async guardarReglaSector(sector, fichadasRequeridas) {
      const cfg = leer();
      const reglasSector = { ...cfg.reglasSector, [sector]: fichadasRequeridas };
      escribir({ ...cfg, reglasSector });
      return reglasSector;
    },

    async crearMotivo(label, worked) {
      const cfg = leer();
      // Same rule as the server: the next id after the highest one in use. Motivo ids are
      // printed into notifications and referenced by the engine, so they are assigned, not
      // generated.
      const id = cfg.motivos.reduce((mayor, m) => Math.max(mayor, m.id), 0) + 1;
      const motivo: Motivo = { id, label: label.trim(), worked };
      escribir({ ...cfg, motivos: [...cfg.motivos, motivo] });
      return motivo;
    },

    async editarMotivo(id, worked) {
      const cfg = leer();
      const motivo = cfg.motivos.find((m) => m.id === id);
      if (!motivo) throw new ErrorRepositorio('Ese motivo ya no existe.');
      const actualizado: Motivo = { ...motivo, worked };
      escribir({
        ...cfg,
        motivos: cfg.motivos.map((m) => (m.id === id ? actualizado : m)),
      });
      return actualizado;
    },

    async retirarMotivo(id) {
      const cfg = leer();
      escribir({ ...cfg, motivos: cfg.motivos.filter((m) => m.id !== id) });
    },

    async agregarExclusion(dni, motivoTexto) {
      const cfg = leer();
      const exclusion: Exclusion = {
        dni,
        motivoTexto,
        creadoPor: 'local',
        creadoAt: new Date().toISOString(),
      };
      escribir({
        ...cfg,
        exclusiones: [...cfg.exclusiones.filter((e) => e.dni !== dni), exclusion].sort((a, b) =>
          a.dni.localeCompare(b.dni),
        ),
      });
      return exclusion;
    },

    async quitarExclusion(dni) {
      const cfg = leer();
      escribir({ ...cfg, exclusiones: cfg.exclusiones.filter((e) => e.dni !== dni) });
    },
  };
}
