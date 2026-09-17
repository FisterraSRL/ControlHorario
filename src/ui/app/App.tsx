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
 * Every screen is real except Indicador, which is routed to `PlaceholderScreen`: it belongs
 * to a later slice, and routing it to a page that says so is more honest than a half-built
 * table.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AusenciasProvider } from '../ausencias/AusenciasProvider.js';
import { ConfiguracionProvider } from '../configuracion/ConfiguracionProvider.js';
import { AccesoContainer } from '../features/acceso/AccesoContainer.js';
import { AusenciasContainer } from '../features/ausencias/AusenciasContainer.js';
import { CargaContainer } from '../features/carga/CargaContainer.js';
import { ConfiguracionContainer } from '../features/configuracion/ConfiguracionContainer.js';
import { HorasContainer } from '../features/horas/HorasContainer.js';
import { IndicadorScreen } from '../features/indicador/IndicadorScreen.js';
import { NotificacionesContainer } from '../features/notificaciones/NotificacionesContainer.js';
import { UsuariosContainer } from '../features/usuarios/UsuariosContainer.js';
import { HistorialProvider } from '../historial/HistorialProvider.js';
import { PeriodoProvider } from '../periodo/PeriodoProvider.js';
import { SesionProvider, useSesion } from '../sesion/SesionProvider.js';
import { AppLayout } from './AppLayout.js';
import { RUTA_INICIAL } from './navegacion.js';

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

  return (
    <ConfiguracionProvider>
      <AusenciasProvider>
        <HistorialProvider>
          <PeriodoProvider>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/carga" element={<CargaContainer />} />
                <Route path="/notificaciones" element={<NotificacionesContainer />} />
                <Route path="/ausencias" element={<AusenciasContainer />} />
                <Route path="/indicador" element={<IndicadorScreen />} />
                <Route path="/horas" element={<HorasContainer />} />
                <Route path="/configuracion" element={<ConfiguracionContainer />} />
                <Route
                  path="/usuarios"
                  element={sesion.operador.rol === 'admin' ? <UsuariosContainer /> : <Navigate to={RUTA_INICIAL} replace />}
                />
                {/* Anything else, including "/", lands on the upload screen. */}
                <Route path="*" element={<Navigate to={RUTA_INICIAL} replace />} />
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
