/**
 * The route table and the two app-wide providers.
 *
 * One screen is real. The other five are routed to `PlaceholderScreen` so that navigation,
 * the sidebar counts and the período control can be exercised end to end without pretending
 * the screens exist.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AusenciasScreen } from '../features/ausencias/AusenciasScreen.js';
import { CargaContainer } from '../features/carga/CargaContainer.js';
import { ConfiguracionScreen } from '../features/configuracion/ConfiguracionScreen.js';
import { HorasScreen } from '../features/horas/HorasScreen.js';
import { IndicadorScreen } from '../features/indicador/IndicadorScreen.js';
import { NotificacionesScreen } from '../features/notificaciones/NotificacionesScreen.js';
import { HistorialProvider } from '../historial/HistorialProvider.js';
import { PeriodoProvider } from '../periodo/PeriodoProvider.js';
import { AppLayout } from './AppLayout.js';
import { RUTA_INICIAL } from './navegacion.js';

export function App() {
  return (
    <BrowserRouter>
      <HistorialProvider>
        <PeriodoProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/carga" element={<CargaContainer />} />
              <Route path="/notificaciones" element={<NotificacionesScreen />} />
              <Route path="/ausencias" element={<AusenciasScreen />} />
              <Route path="/indicador" element={<IndicadorScreen />} />
              <Route path="/horas" element={<HorasScreen />} />
              <Route path="/configuracion" element={<ConfiguracionScreen />} />
              {/* Anything else, including "/", lands on the one screen that works. */}
              <Route path="*" element={<Navigate to={RUTA_INICIAL} replace />} />
            </Route>
          </Routes>
        </PeriodoProvider>
      </HistorialProvider>
    </BrowserRouter>
  );
}
