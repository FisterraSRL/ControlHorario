/**
 * The route table and the app-wide providers.
 *
 * THE PROVIDER ORDER IS A DEPENDENCY ORDER, not a preference:
 *
 *   SesionProvider          creates every repository (together, so a build cannot end up
 *                           half on the server and half on localStorage) and decides
 *                           whether anybody is logged in. Nothing below it runs until it
 *                           has an answer.
 *     ConfiguracionProvider the engine's thresholds and the motivos list.
 *       AusenciasProvider   the decisions already on record.
 *         HistorialProvider derives every `RegistroDia` from the evidence PLUS the two
 *                           above. It is last because it needs both: a day's motivo comes
 *                           from the registry and its faults from the thresholds.
 *           PeriodoProvider the día / semana / mes / año window the screens are read
 *                           through. It depends on nothing and is innermost so that
 *                           changing the period does not re-run a repository read.
 *
 * Every route below points at a real screen; none of them is a placeholder any more.
 *
 * THE ROUTE TABLE IS GENERATED FROM `SECCIONES`, so the sidebar and the guards cannot
 * disagree about who may open what: both read the same `roles` field. A route this role may
 * not open redirects to that role's own landing route rather than to a constant `/carga`,
 * which an encargado is answered 403 from.
 */

import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AusenciasProvider } from '../ausencias/AusenciasProvider.js';
import { ConfiguracionProvider } from '../configuracion/ConfiguracionProvider.js';
import { AccesoContainer } from '../features/acceso/AccesoContainer.js';
import { AusenciasContainer } from '../features/ausencias/AusenciasContainer.js';
import { CargaContainer } from '../features/carga/CargaContainer.js';
import { ConfiguracionContainer } from '../features/configuracion/ConfiguracionContainer.js';
import { HorasContainer } from '../features/horas/HorasContainer.js';
import { IndicadorContainer } from '../features/indicador/IndicadorContainer.js';
import { MiCuentaContainer } from '../features/micuenta/MiCuentaContainer.js';
import { NotificacionesContainer } from '../features/notificaciones/NotificacionesContainer.js';
import { UsuariosContainer } from '../features/usuarios/UsuariosContainer.js';
import { HistorialProvider } from '../historial/HistorialProvider.js';
import { PeriodoProvider } from '../periodo/PeriodoProvider.js';
import { SesionProvider, useSesion } from '../sesion/SesionProvider.js';
import { AppLayout } from './AppLayout.js';
import { permiteRol, rutaInicialDeRol, SECCIONES, type IdSeccion } from './navegacion.js';

/** Which screen each section is. The only place a section id meets a component. */
const PANTALLAS: Readonly<Record<IdSeccion, ReactElement>> = {
  carga: <CargaContainer />,
  notificaciones: <NotificacionesContainer />,
  ausencias: <AusenciasContainer />,
  indicador: <IndicadorContainer />,
  horas: <HorasContainer />,
  configuracion: <ConfiguracionContainer />,
  usuarios: <UsuariosContainer />,
  cuenta: <MiCuentaContainer />,
};

/**
 * The whole application, or the login screen.
 *
 * Nothing under `Autenticado` is mounted while there is no session, which means no provider
 * below it ever fires a request that would come back 401 — the login screen is not a
 * decoration over a running app, it is what runs instead of one.
 */
function Autenticado() {
  const { sesion, cargando } = useSesion();

  // Blank rather than a spinner: this resolves in one request against the same origin, and
  // a flash of "cargando" before a login form reads as a broken page.
  if (cargando) return null;
  if (!sesion) return <AccesoContainer />;

  const { rol } = sesion.operador;
  const inicial = rutaInicialDeRol(rol);

  return (
    <ConfiguracionProvider>
      <AusenciasProvider>
        <HistorialProvider>
          <PeriodoProvider>
            <Routes>
              <Route element={<AppLayout />}>
                {SECCIONES.map((seccion) => (
                  <Route
                    key={seccion.id}
                    path={seccion.path}
                    element={
                      permiteRol(seccion, rol) ? (
                        PANTALLAS[seccion.id]
                      ) : (
                        <Navigate to={inicial} replace />
                      )
                    }
                  />
                ))}
                {/* Anything else, including "/", lands on this role's first section. */}
                <Route path="*" element={<Navigate to={inicial} replace />} />
              </Route>
            </Routes>
          </PeriodoProvider>
        </HistorialProvider>
      </AusenciasProvider>
    </ConfiguracionProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SesionProvider>
        <Autenticado />
      </SesionProvider>
    </BrowserRouter>
  );
}
