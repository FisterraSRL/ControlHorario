import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { construirRegistroDia, type RegistroDia } from '../../domain/fichadas/index.js';
import { NotificacionesContainer } from '../features/notificaciones/NotificacionesContainer.js';
import { HorasContainer } from '../features/horas/HorasContainer.js';
import { IndicadorContainer } from '../features/indicador/IndicadorContainer.js';
import { filtrarPersonas, type PersonaFiltrable } from './filtro.js';
import { construirReporteHoras, csvDeHoras, desplegarTodas } from '../features/horas/horas.js';
import { agruparFaltasPorPersona } from '../faltas/agrupacion.js';
import { separarPorDia } from '../faltas/porDia.js';
import { personasSeleccionadas, seleccionVisible } from '../features/notificaciones/notificaciones.js';

const state = vi.hoisted(() => ({ registros: [] as RegistroDia[], filtro: {busqueda: '', sector: ''} }));
vi.mock('./filtro.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./filtro.js')>();
  return { ...actual, useFiltroPersonas: (todas: readonly PersonaFiltrable[]) => {
    const personas = actual.filtrarPersonas(todas, state.filtro);
    return { personas, filtro:state.filtro, sectores:actual.sectoresDelPeriodo(todas), setFiltro:vi.fn(),
      total:new Set(todas.map(p => p.dni)).size, cantidad:new Set(personas.map(p => p.dni)).size,
      sinCoincidencias:todas.length > 0 && personas.length === 0 };
  } };
});
vi.mock('../historial/HistorialProvider.js', () => ({ useHistorial: () => ({ registros:state.registros, cargando:false, error:null }) }));
vi.mock('../configuracion/ConfiguracionProvider.js', () => ({ useConfiguracion: () => ({ paraElMotor:{} }) }));
vi.mock('../periodo/PeriodoProvider.js', () => ({ usePeriodo: () => ({ periodo:{modo:'semana',ancla:new Date('2026-09-14')}, rango:{desde:new Date('2026-09-14'),hasta:new Date('2026-09-20')} }) }));
vi.mock('../notificaciones/NotificadasProvider.js', () => ({ useNotificadas: () => ({ notificadas:new Set(), error:null, cargando:false }) }));
vi.mock('../ausencias/AusenciasProvider.js', () => ({ useAusencias: () => ({ error:null }) }));
vi.mock('../sesion/SesionProvider.js', () => ({ useSesion: () => ({ repositorios:{envios:{}} }) }));

function registros() {
  return ['José Pérez', 'Ana López'].map((Usuario, i) => construirRegistroDia({Sector:i ? 'Taller' : 'Ventas', Usuario, DNI:String(i+1), Legajo:'1', Fecha:'15/09/2026', Movimientos:'08:20 - 12:00 - 13:00', Turno:'08:00 - 17:00', 'Horas Turno':'9:00', Horas:'4:00', 'Cantidad Tarde':'0:20', Partes:''}));
}

for (const Screen of [NotificacionesContainer, HorasContainer, IndicadorContainer]) {
  describe(Screen.name, () => {
    it('shows only matching people while retaining the period sector options', () => {
      state.registros = registros(); state.filtro = { busqueda:'jose', sector:'"Ventas"' };
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Screen)));
      expect(html).toContain('José Pérez'); expect(html).not.toContain('Ana López');
      expect(html).toContain('Taller'); expect(html).toContain('Mostrando 1 de 2 personas');
    });
    it('distinguishes no filter matches from an empty period', () => {
      state.registros = registros(); state.filtro = { busqueda:'desconocida', sector:'' };
      const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Screen)));
      expect(render()).toContain('No hay personas que coincidan con los filtros.');
      state.registros = [];
      expect(render()).not.toContain('No hay personas que coincidan con los filtros.');
    });
  });
}

describe('filtered operations', () => {
  const rango = {desde:new Date('2026-09-14'),hasta:new Date('2026-09-20')};
  it('exports and opens only matching weeks', () => {
    const todas = construirReporteHoras(registros(), {}, rango);
    const visibles = filtrarPersonas(todas, {busqueda:'jose',sector:''});
    expect(csvDeHoras(visibles)).toContain('José Pérez');
    expect(csvDeHoras(visibles)).not.toContain('Ana López');
    expect([...desplegarTodas(visibles, true)]).toEqual(['1|2026-09-14']);
  });
  it('never prepares hidden people and pruning prevents selection reappearance', () => {
    const todas = agruparFaltasPorPersona(registros(), {}, rango);
    const visibles = filtrarPersonas(todas, {busqueda:'jose',sector:''});
    const dias = new Map(visibles.map(p => [p.dni, separarPorDia(p)]));
    const previa = new Map(todas.map(p => [p.dni, new Set(separarPorDia(p).map(d => d.fecha))]));
    const vigente = seleccionVisible(previa, dias);
    expect(personasSeleccionadas(visibles, vigente).map(p => p.dni)).toEqual(['1']);
    expect(personasSeleccionadas(visibles, vigente, '2')).toEqual([]);
    expect([...seleccionVisible(vigente, new Map(todas.map(p => [p.dni, separarPorDia(p)]))).keys()]).toEqual(['1']);
  });
  it('renders indicator totals for the visible people only', () => {
    state.registros = registros(); state.filtro = {busqueda:'jose',sector:''};
    const html = renderToStaticMarkup(createElement(IndicadorContainer));
    const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(m => m[1]!);
    const cells = (row:string) => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1]);
    const person = rows.find(r => r.includes('José Pérez'))!;
    const total = rows.find(r => r.includes('Total visible'))!;
    expect(cells(total).slice(2)).toEqual(cells(person).slice(2));
  });
});
