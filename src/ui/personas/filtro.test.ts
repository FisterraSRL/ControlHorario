import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FILTRO_PERSONAS_INICIAL, filtrarPersonas, sectoresDelPeriodo } from './filtro.js';
import { FiltrosPersonas } from './FiltrosPersonas.js';

const personas = [
  { usuario: 'José Pérez', dni: '20.123.456', sector: 'Ventas' },
  { usuario: 'Josefina', dni: '30123456', sector: 'Administración' },
  { usuario: 'Sin área', dni: '40123456', sector: '' },
];
describe('person filters', () => {
  it.each(['JOSE PEREZ', ' José Pérez ', '20-123-456', '20123456'])('matches names and formatted DNI: %s', busqueda => {
    expect(filtrarPersonas(personas, { busqueda, sector: '' })).toEqual([personas[0]]);
  });
  it('combines name and sector rather than widening the match', () => {
    expect(filtrarPersonas(personas, { busqueda: 'jose', sector: '"Ventas"' })).toEqual([personas[0]]);
    expect(filtrarPersonas(personas, { busqueda: 'jose', sector: '"Administración"' })).toEqual([personas[1]]);
    expect(filtrarPersonas(personas, { busqueda: 'jose', sector: '""' })).toEqual([]);
  });
  it('offers only real distinct sectors, including the missing sector', () => {
    expect(sectoresDelPeriodo([...personas, personas[0]!])).toEqual([
      { valor: '""', label: 'Sin sector' }, { valor: '"Administración"', label: 'Administración' }, { valor: '"Ventas"', label: 'Ventas' },
    ]);
  });
  it('does not turn punctuation into a match for every DNI', () => {
    expect(filtrarPersonas(personas, { busqueda: '---', sector: '' })).toEqual([]);
  });
  it('clears both filters with one action', () => {
    const onCambio = vi.fn();
    const barra = FiltrosPersonas({ filtro: {busqueda: 'jose', sector:'"Ventas"'}, sectores: [], cantidad:1, total:3, onCambio });
    barra.props.children[2].props.onClick();
    expect(onCambio).toHaveBeenCalledWith(FILTRO_PERSONAS_INICIAL);
    expect(filtrarPersonas(personas, FILTRO_PERSONAS_INICIAL)).toEqual(personas);
  });
  it('keeps an unavailable sector visible and clearable after a period change', () => {
    const filtro = { busqueda: '', sector: '"Ventas"' };
    expect(filtrarPersonas([personas[1]!], filtro)).toEqual([]);
    const html = renderToStaticMarkup(createElement(FiltrosPersonas, {filtro, sectores:sectoresDelPeriodo([personas[1]!]), cantidad:0, total:1, onCambio:vi.fn()}));
    expect(html).toContain('Ventas (sin datos en este período)');
    expect(html).toContain('Mostrando 0 de 1 personas');
    expect(html).not.toContain('disabled');
  });
});
