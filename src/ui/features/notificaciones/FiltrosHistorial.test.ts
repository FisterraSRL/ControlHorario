import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FiltrosHistorialForm } from './FiltrosHistorial.js';
describe('history filter form contract',()=>{
  it('labels snapshot search, document dates and current mark filters separately from global period',()=>{
    const html=renderToStaticMarkup(createElement(FiltrosHistorialForm,{ocupado:false,onAplicar(){}}));
    expect(html).toContain('Persona o DNI');expect(html).toContain('Sector del documento');expect(html).toContain('Documento desde');expect(html).toContain('Documento hasta');
    expect(html).toContain('Con faltas marcadas');expect(html).toContain('Sin faltas marcadas');expect(html).toContain('no al período del encabezado');expect(html).toContain('no confirman la entrega');
    expect(html).toContain('type="submit"');
  });
  it('blocks applying or clearing filters while a mutation is pending',()=>{
    const html=renderToStaticMarkup(createElement(FiltrosHistorialForm,{ocupado:true,onAplicar(){}}));
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
