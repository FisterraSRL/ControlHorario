import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MOTIVOS_POR_DEFECTO } from '../../../domain/fichadas/index.js';
import { AusenciasScreen, type AusenciasScreenProps } from './AusenciasScreen.js';
import { FILTRO_INICIAL, type FilaAusencia } from './ausencias.js';

const clasificada: FilaAusencia = {
  clave: 'TEST|2026-10-12', dni: 'TEST', fechaIso: '2026-10-12',
  fechaStr: '12/10/2026', fecha: new Date('2026-10-12T00:00:00Z'),
  usuario: 'Persona de prueba', sector: 'Prueba', legajo: '', turnoRaw: '',
  partesRaw: '', motivoId: 4, motivoSource: 'manual', resueltoPor: null,
  adjuntos: [],
};
const noop = () => {};

function render(overrides = {}) {
  const props = {
    vista: { enPeriodo: [clasificada], filas: [], pendientes: 0, total: 1, sectores: [], personas: [] },
    filtro: FILTRO_INICIAL, onFiltro: noop, motivos: MOTIVOS_POR_DEFECTO,
    abiertas: new Set<string>(), onAlternar: noop, onMotivo: noop,
    adjuntosDisponibles: true, claveOcupada: null, onSubir: noop, onDescargar: noop,
    onEliminar: noop, seleccion: new Set<string>(), estadoSeleccion: 'ninguna',
    onSeleccionar: noop, onSeleccionarVisibles: noop, onLimpiarSeleccion: noop,
    motivoLote: '', onMotivoLote: noop, onAplicarLote: noop, loteAplicable: false,
    maxLote: 500, cargando: false, error: null, aviso: null,
    recientes: [clasificada], onCerrarReciente: noop,
    ...overrides,
  } satisfies AusenciasScreenProps & { recientes: readonly FilaAusencia[]; onCerrarReciente: (clave: string) => void };
  return renderToStaticMarkup(createElement(AusenciasScreen, props));
}

describe('attachments after classification', () => {
  it('keeps the classified day and upload action visible after it leaves the pending table', () => {
    const html = render();
    expect(html).toContain('aria-label="Recién clasificadas"');
    expect(html).toContain('Persona de prueba');
    expect(html).toContain('12/10/2026');
    expect(html).toContain('Adjuntar archivo');
    expect(html).toContain('No hay ausencias sin clasificar');
    expect(html).not.toContain('Seleccionar la ausencia de Persona de prueba');
  });

  it('disables dismissal and motivo changes while the recent attachment is being uploaded', () => {
    const html = render({ claveOcupada: clasificada.clave });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Listo/);
    expect(html).toMatch(/<select[^>]*aria-label="Motivo de Persona de prueba el 12\/10\/2026"[^>]*disabled=""/);
    expect(html).toContain('Subiendo…');
  });

  it('keeps the panel available when attachment upload fails', () => {
    const html = render({ error: 'No se pudo adjuntar el archivo.' });
    expect(html).toContain('No se pudo adjuntar el archivo.');
    expect(html).toContain('Adjuntar archivo');
    expect(html).toMatch(/<button[^>]*>Listo/);
  });

  it('shows uploaded attachments in the retained panel with download and removal actions', () => {
    const adjunto = { id: '1', dni: 'TEST', fecha: '2026-10-12', nombre: 'prueba.pdf', bytes: 20, tipoMime: 'application/pdf', subidoPor: null, subidoAt: '2026-10-12T10:00:00Z' };
    const html = render({ recientes: [{ ...clasificada, adjuntos: [adjunto] }] });
    expect(html).toContain('prueba.pdf');
    expect(html).toContain('Descargar');
    expect(html).toContain('Quitar');
  });

  it('omits the transient section when every recent day has been dismissed', () => {
    expect(render({ recientes: [] })).not.toContain('aria-label="Recién clasificadas"');
  });

  it('uses the normal attachment row when the filter already shows classified absences', () => {
    const html = render({
      filtro: { ...FILTRO_INICIAL, soloPendientes: false },
      vista: { enPeriodo: [clasificada], filas: [clasificada], pendientes: 0, total: 1, sectores: [], personas: [] },
      abiertas: new Set([clasificada.clave]),
    });
    expect(html).not.toContain('aria-label="Recién clasificadas"');
    expect([...html.matchAll(/>Adjuntar archivo</g)].length).toBe(1);
  });
});
