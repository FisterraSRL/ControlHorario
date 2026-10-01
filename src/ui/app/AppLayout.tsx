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
import { useConfiguracion } from '../configuracion/ConfiguracionProvider.js';
import { useHistorial } from '../historial/HistorialProvider.js';
import { useSesion } from '../sesion/SesionProvider.js';
import { usePeriodo } from '../periodo/PeriodoProvider.js';
import {
  MODOS_PERIODO,
  etiquetaPeriodo,
  etiquetaRango,
  hoyUTC,
  type ModoPreset,
} from '../periodo/periodo.js';
import { pluralizar } from '../texto.js';
import { AppShell } from './AppShell.js';
import { CONTADORES_VACIOS, contarPendientes, registrosDelPeriodo } from './contadores.js';
import { rutaInicialDeRol, seccionDeRuta, seccionesDeRol } from './navegacion.js';
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
  const { periodo, rango, cambiarModo, desplazar, fijarRango } = usePeriodo();
  const { registros, cargando } = useHistorial();
  const { sesion, repositorios, cerrar } = useSesion();
  // The engine config WITHOUT the decisions: `registros` already carries each day's motivo,
  // resolved by `HistorialProvider`, and the weekly report only needs the motivos list and
  // the contractual hours to turn them into counts.
  const { paraElMotor: cfg } = useConfiguracion();

  const contadores = useMemo(() => {
    if (cargando) return CONTADORES_VACIOS;
    return contarPendientes(registrosDelPeriodo(registros, rango), cfg);
  }, [registros, rango, cfg, cargando]);

  // `null` only in the instant before the session resolves; `App` does not mount this
  // layout without one.
  const rol = sesion?.operador.rol ?? null;

  const seccion =
    seccionDeRuta(pathname) ?? (rol ? seccionDeRuta(rutaInicialDeRol(rol)) : undefined);

  // The menu IS the role's section list. No exception per section, so a new section is
  // gated by the `roles` field it declares in navegacion.ts and nowhere else. The badges
  // keep counting whatever the historial holds: the server already narrowed those rows to
  // the sectors this account supervises, so an encargado's badge is their own count.
  const items = useMemo<readonly ItemSidebar[]>(
    () =>
      (rol === null ? [] : seccionesDeRol(rol)).map((s) => {
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
    [contadores, rol],
  );

  const modos = useMemo(
    () => MODOS_PERIODO.map((m) => ({ valor: m.modo, label: m.label })),
    [],
  );

  return (
    <AppShell
      sidebar={<Sidebar items={items} rutaActiva={seccion?.path ?? pathname} />}
      topbar={
        <Topbar<ModoPreset>
          titulo={seccion?.titulo ?? 'Control de Fichadas'}
          mostrarPeriodo={seccion?.muestraPeriodo ?? false}
          modos={modos}
          // A hand-picked range is not a preset, so no segment is on while it is in force.
          modoActivo={periodo.modo === 'rango' ? null : periodo.modo}
          onModo={cambiarModo}
          onDesplazar={desplazar}
          etiquetaAncla={etiquetaPeriodo(periodo)}
          // The button already spells both ends of a range; the second label would repeat it.
          etiquetaRango={periodo.modo === 'rango' ? null : etiquetaRango(rango)}
          rango={rango}
          // Read on every render rather than memoised: the app can stay open past midnight.
          hoy={hoyUTC()}
          onRango={fijarRango}
          operador={sesion?.operador.nombre ?? null}
          sinServidor={!repositorios.conServidor}
          onSalir={() => {
            void cerrar();
          }}
        />
      }
    >
      <Outlet />
    </AppShell>
  );
}
