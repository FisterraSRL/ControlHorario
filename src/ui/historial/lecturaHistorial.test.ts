import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { construirRegistroDia, type RegistroDia } from '../../domain/fichadas/index.js';
import { NotificacionesContainer } from '../features/notificaciones/NotificacionesContainer.js';
import { HorasContainer } from '../features/horas/HorasContainer.js';
import { IndicadorContainer } from '../features/indicador/IndicadorContainer.js';
import { AusenciasContainer } from '../features/ausencias/AusenciasContainer.js';

const state = vi.hoisted(() => ({ registros: [] as RegistroDia[], cargando: false, error: null as string | null }));
vi.mock('./HistorialProvider.js', () => ({ useHistorial: () => ({ ...state, recargar: () => {} }) }));
vi.mock('../configuracion/ConfiguracionProvider.js', () => ({ useConfiguracion: () => ({ paraElMotor: {}, configuracion: null }) }));
vi.mock('../periodo/PeriodoProvider.js', () => ({ usePeriodo: () => ({ periodo: {modo:'semana', ancla:new Date('2026-09-14')}, rango: {desde:new Date('2026-09-14'), hasta:new Date('2026-09-20')} }) }));
vi.mock('../notificaciones/NotificadasProvider.js', () => ({ useNotificadas: () => ({ notificadas:new Set(), error:null, cargando:false }) }));
vi.mock('../ausencias/AusenciasProvider.js', () => ({ useAusencias: () => ({ ausencias:[], cargando:false, error:null }) }));
vi.mock('../sesion/SesionProvider.js', () => ({ useSesion: () => ({ repositorios:{envios:{}, adjuntos:{disponible:false}} }) }));

for (const Screen of [NotificacionesContainer, HorasContainer, IndicadorContainer, AusenciasContainer]) {
  describe(Screen.name, () => {
    it('replaces derived tables and actions with a retryable history error', () => {
      state.registros = [construirRegistroDia({Sector:'Test', Usuario:'Stale person', DNI:'1', Legajo:'1', Fecha:'15/09/2026', Movimientos:'08:20 - 12:00 - 13:00', Turno:'08:00 - 17:00', 'Horas Turno':'9:00', Horas:'4:00', 'Cantidad Tarde':'0:20', Partes:''})];
      state.cargando = false; state.error = 'Consulta fallida';
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Screen)));
      expect(html).toContain('role="alert"');
      expect(html).toContain('Reintentar');
      expect(html).not.toContain('<table');
      expect(html).not.toContain('Stale person');
    });
    it('does not show empty results or actions while the history is loading', () => {
      state.cargando = true; state.error = null;
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Screen)));
      expect(html).toContain('role="status"');
      expect(html).not.toContain('<table');
    });
    it('renders the empty result after a successful read', () => {
      state.registros = [];
      state.cargando = false; state.error = null;
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Screen)));
      expect(html).toContain('<table');
      expect(html).not.toContain('Reintentar');
    });
  });
}
