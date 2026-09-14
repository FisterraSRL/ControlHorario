/**
 * Container for the shell.
 *
 * It reads the two pieces of app-wide state — the período and the historial — turns them
 * into the sidebar counts and the topbar labels, and hands plain props to presentational
 * components. Everything below it receives data, not context.
 */

import { useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { Sidebar } from '../components/organisms/Sidebar/Sidebar.js';
import type { ItemSidebar } from '../components/organisms/Sidebar/Sidebar.js';
import { Topbar } from '../components/organisms/Topbar/Topbar.js';
import { configuracionPorDefecto } from '../features/configuracion/configuracion.js';
import { useHistorial } from '../historial/HistorialProvider.js';
import { usePeriodo } from '../periodo/PeriodoProvider.js';
import {
  MODOS_PERIODO,
  etiquetaAncla,
  etiquetaRango,
  type ModoPeriodo,
} from '../periodo/periodo.js';
import { pluralizar } from '../texto.js';
import { AppShell } from './AppShell.js';
import { CONTADORES_VACIOS, contarPendientes, registrosDelPeriodo } from './contadores.js';
import { RUTA_INICIAL, SECCIONES, seccionDeRuta } from './navegacion.js';
import type { ContadoresNav } from './contadores.js';
import type { TipoContador } from './navegacion.js';

const DESCRIPCIONES: Readonly<Record<TipoContador, (n: number) => string>> = {
  faltas: (n) => `${pluralizar(n, 'falta detectada', 'faltas detectadas')} en el período`,
  ausenciasPendientes: (n) =>
    `${pluralizar(n, 'ausencia sin clasificar', 'ausencias sin clasificar')} en el período`,
  semanasSinClasificar: (n) =>
    `${pluralizar(n, 'semana', 'semanas')} con ausencias sin clasificar`,
};

function valorContador(contadores: ContadoresNav, tipo: TipoContador): number {
  return contadores[tipo];
}

export function AppLayout() {
  const { pathname } = useLocation();
  const { periodo, rango, cambiarModo, desplazar } = usePeriodo();
  const { registros, cargando } = useHistorial();

  const cfg = useMemo(configuracionPorDefecto, []);

  const contadores = useMemo(() => {
    if (cargando) return CONTADORES_VACIOS;
    return contarPendientes(registrosDelPeriodo(registros, rango), cfg);
  }, [registros, rango, cfg, cargando]);

  const seccion = seccionDeRuta(pathname) ?? seccionDeRuta(RUTA_INICIAL);

  const items = useMemo<readonly ItemSidebar[]>(
    () =>
      SECCIONES.map((s) => {
        const n = s.contador ? valorContador(contadores, s.contador) : null;
        return {
          path: s.path,
          label: s.label,
          icono: s.icono,
          contador: n,
          ...(s.contador && n !== null
            ? { descripcionContador: DESCRIPCIONES[s.contador](n) }
            : {}),
        };
      }),
    [contadores],
  );

  const modos = useMemo(
    () => MODOS_PERIODO.map((m) => ({ valor: m.modo, label: m.label })),
    [],
  );

  return (
    <AppShell
      sidebar={<Sidebar items={items} rutaActiva={seccion?.path ?? pathname} />}
      topbar={
        <Topbar<ModoPeriodo>
          titulo={seccion?.titulo ?? 'Control de Fichadas'}
          mostrarPeriodo={seccion?.muestraPeriodo ?? false}
          modos={modos}
          modoActivo={periodo.modo}
          onModo={cambiarModo}
          onDesplazar={desplazar}
          etiquetaAncla={etiquetaAncla(periodo.ancla)}
          etiquetaRango={etiquetaRango(rango)}
        />
      }
    >
      <Outlet />
    </AppShell>
  );
}
