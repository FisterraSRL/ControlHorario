import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SemanaEmpleado } from '../../../domain/fichadas/index.js';
import { HorasScreen } from './HorasScreen.js';

const row: SemanaEmpleado = { dni: 'TEST', usuario: 'Fictional person', legajo: '1', sector: 'Test', inicioSemana: '2026-09-14', horasTrabajadas: 455, horasJustificadas: 480, horasTurno: 960, horasDescanso: 35, diferencia: -25, diasAusenciaSinClasificar: 0, dias: [] };
function render(semanas: readonly SemanaEmpleado[], abiertas: ReadonlySet<string> = new Set()) {
  return renderToStaticMarkup(createElement(HorasScreen, { semanas, abiertas, motivos: [], todasAbiertas: false, cargando: false, onAlternar() {}, onAlternarTodas() {}, onMotivo() {}, onExportar() {}, error: null, aviso: null, semanasParciales: null }));
}
describe('weekly hours presentation', () => {
  it('labels and renders three distinct hour values matching the same row', () => {
    const html = render([row]);
    expect(html).toContain('<th>Trabajadas</th><th>Justificadas</th><th>Total computable</th>');
    expect(html).toMatch(/>16:00<\/td><td[^>]*>7:35<\/td><td[^>]*>8:00<\/td><td[^>]*>15:35<\/td><td[^>]*>0:35<\/td><td[^>]*>-0:25<\/td>/);
    expect(html).toContain('horas:minutos');
  });
  it('spans the expanded detail, sector and empty rows across the new columns', () => {
    expect(render([row], new Set(['TEST|2026-09-14']))).toContain('colSpan="9"');
    expect(render([row])).toContain('colSpan="10"');
    expect(render([])).toContain('colSpan="10"');
  });
});
