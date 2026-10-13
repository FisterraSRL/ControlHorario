import { describe, expect, it } from 'vitest';
import { coincideDocumento, normalizarFiltros, problemaFiltros } from './filtrosHistorial.js';
import type { DocumentoEmitido } from './envios.js';
const doc: DocumentoEmitido = { id:'one', emisionId:'issue', creadoAt:'2026-10-01', emitidoAt:'2026-10-02', fechaDocumento:'2026-10-02', snapshot:{ usuario:'Persona Ficticia', dni:'TEST-123', sector:'Sector prueba', faltasPorTipo:{ incompleta:[], descanso:[], tardanza:[] } }, activas:[] };
describe('whole-history filter semantics', () => {
  it('matches literal case-insensitive name/DNI and snapshot sector, combining filters', () => {
    expect(coincideDocumento(doc,{ busqueda:' ficticia ', sector:'PRUEBA' })).toBe(true);
    expect(coincideDocumento(doc,{ busqueda:'test-123' })).toBe(true);
    expect(coincideDocumento(doc,{ busqueda:'Ficticia',sector:'Different' })).toBe(false);
    expect(coincideDocumento(doc,{ busqueda:'%' })).toBe(false);
  });
  it('includes both date edges using document date rather than emission time', () => {
    expect(coincideDocumento({...doc,emitidoAt:'2026-11-01'},{ desde:'2026-10-02',hasta:'2026-10-02' })).toBe(true);
    expect(coincideDocumento(doc,{ desde:'2026-10-03' })).toBe(false);
    expect(coincideDocumento(doc,{ hasta:'2026-10-01' })).toBe(false);
  });
  it('distinguishes current mark ownership without claiming document invalidity', () => {
    expect(coincideDocumento(doc,{ marcas:'sin' })).toBe(true);
    expect(coincideDocumento(doc,{ marcas:'con' })).toBe(false);
    expect(coincideDocumento({...doc,activas:[{dni:'TEST',fechaIso:'2026-10-01',tipo:'tardanza',version:'one',notificadoAt:'2026-10-02'}]},{marcas:'con'})).toBe(true);
  });
  it('rejects impossible/inverted dates and oversized text', () => {
    expect(problemaFiltros({desde:'2026-02-30'})).not.toBeNull();
    expect(problemaFiltros({desde:'2026-10-03',hasta:'2026-10-02'})).not.toBeNull();
    expect(problemaFiltros({busqueda:'a'.repeat(301)})).not.toBeNull();
    expect(normalizarFiltros({busqueda:'  ',sector:' S ',desde:''})).toEqual({sector:'S'});
  });
});
