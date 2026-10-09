import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotificacionPersona } from '../../../notificaciones/index.js';
import { IndicadorScreen } from './IndicadorScreen.js';

const persona: NotificacionPersona = {
  usuario: 'Persona', dni: 'TEST', sector: 'Prueba',
  faltasPorTipo: { incompleta: [], descanso: [], tardanza: [
    { fecha: '14/09/2026', fechaOrden: new Date('2026-09-14T00:00:00Z'), turnoRaw: '08:00 - 16:00', horarioFichado: '08:20', minutos: '0:20' },
  ] },
};

function documentCounts(errorNotificadas: string | null, cargandoNotificadas = false, count = 1) {
  const html = renderToStaticMarkup(createElement(IndicadorScreen, {
    personas: [persona], totales: { porTipo: { incompleta: 0, descanso: 0, tardanza: 1 }, total: 1 },
    notificadas: { porDni: new Map([['TEST', count]]), total: count },
    cargando: false, cargandoNotificadas, errorNotificadas,
  }));
  // Read the last cell of the person and total rows, excluding the sector heading.
  return [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].flatMap((row) => {
    const cells = [...row[1]!.matchAll(/<td[^>]*>(.*?)<\/td>/g)];
    return cells.length > 1 ? [cells.at(-1)![1]] : [];
  });
}

describe('document counts in the indicator', () => {
  it.each([0, 1])('hides both person and period counts after a read error, even with stored value %i', (count) => {
    expect(documentCounts('No se pudo consultar', false, count)).toEqual(['…', '…']);
  });

  it('hides both counts while reloading', () => {
    expect(documentCounts(null, true)).toEqual(['…', '…']);
  });

  it.each([0, 1])('shows confirmed person and period counts after a successful read: %i', (count) => {
    expect(documentCounts(null, false, count)).toEqual([String(count), String(count)]);
  });
});
