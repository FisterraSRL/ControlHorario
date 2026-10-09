import { describe, expect, it, vi } from 'vitest';
import { utils, write } from 'xlsx';
import { crearImportacion, type EstadoImportacion } from './importacion.js';
import { leerPlanilla, type PlanillaLeida } from './planilla.js';
import { prepararVistaPrevia } from './vistaPrevia.js';
import { crearRepositorioLocal } from '../../historial/repositorioLocal.js';
const fila = { DNI: 'TEST-101', Fecha: '09/10/2026', Turno: '08:00 - 17:00', Movimientos: '08:00 - 17:00', Horas: '9:00' };
const planilla = (filas = [fila]): PlanillaLeida => ({ archivo: 'test.xlsx', hoja: 'Fichadas', filas, columnasFaltantes: [] });
const archivo = {} as File;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function setup(leer = vi.fn(async () => planilla())) {
  const repo = crearRepositorioLocal(null);
  const guardar = vi.fn(repo.upsert);
  const publicar = vi.fn<(e: EstadoImportacion) => void>();
  const historial = { filas: [], disponible: true };
  const control = crearImportacion({ leer, guardar, publicar, historial: () => historial });
  return { ...control, repo, guardar, publicar, historial, estado: () => publicar.mock.lastCall![0] };
}
describe('import preview flow', () => {
  it('reads without writing and saves only after confirmation', async () => {
    const c=setup(); await c.seleccionar(archivo); expect(c.guardar).not.toHaveBeenCalled();
    expect(await c.repo.listar()).toEqual([]); await c.confirmar();
    expect(c.guardar).toHaveBeenCalledOnce(); expect(await c.repo.listar()).toEqual([fila]); expect(c.estado().fase).toBe('terminada');
  });
  it('cancel discards the candidate without a write', async () => { const c=setup(); await c.seleccionar(archivo); c.cancelar(); await c.confirmar(); expect(c.guardar).not.toHaveBeenCalled(); });
  it('ignores an older file completing after the replacement', async () => {
    const a=deferred<PlanillaLeida>(), b=deferred<PlanillaLeida>(); const leer=vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const c=setup(leer); const pa=c.seleccionar(archivo); const pb=c.seleccionar(archivo);
    b.resolve({ ...planilla(), archivo:'nuevo.xlsx' }); await pb; a.resolve(planilla()); await pa;
    expect(c.estado().previa?.planilla.archivo).toBe('nuevo.xlsx');
  });
  it('ignores a read cancelled while pending', async () => { const d=deferred<PlanillaLeida>(); const c=setup(vi.fn(() => d.promise)); const p=c.seleccionar(archivo); c.cancelar(); d.resolve(planilla()); await p; expect(c.estado().fase).toBe('inicial'); });
  it('ignores an obsolete read error', async () => { const d=deferred<PlanillaLeida>(); const c=setup(vi.fn(() => d.promise)); const p=c.seleccionar(archivo); c.cancelar(); d.reject(new Error('old')); await p; expect(c.estado().error).toBeNull(); });
  it('cannot confirm twice or change/cancel during a save', async () => {
    const c=setup(); const d=deferred<Awaited<ReturnType<typeof c.guardar>>>(); c.guardar.mockImplementation(() => d.promise);
    await c.seleccionar(archivo); const saving=c.confirmar(); await c.confirmar(); c.cancelar(); await c.seleccionar(archivo);
    expect(c.guardar).toHaveBeenCalledOnce(); expect(c.estado().fase).toBe('guardando');
    d.resolve({ recibidas:1, nuevas:1, actualizadas:0, sinCambios:0, descartadas:0, totalHistorial:1 }); await saving;
  });
  it('consumes failed writes, warns of uncertainty and never retries', async () => {
    const c=setup(); c.guardar.mockRejectedValue(new Error('refresh failed')); await c.seleccionar(archivo); await c.confirmar(); await c.confirmar();
    expect(c.guardar).toHaveBeenCalledOnce(); expect(c.estado().error).toContain('Es posible que los datos se hayan guardado'); expect(c.estado().previa).toBeNull();
  });
  it('blocks on unavailable history and prevents confirming stale readiness', async () => {
    const c=setup(); await c.seleccionar(archivo); c.historial.disponible=false; await c.confirmar(); expect(c.guardar).not.toHaveBeenCalled(); await c.seleccionar(archivo); expect(c.estado().fase).toBe('error');
  });
  it('does not save an invalid candidate', async () => { const c=setup(vi.fn(async () => planilla([{ ...fila, Fecha:'31/02/2026' }]))); await c.seleccionar(archivo); await c.confirmar(); expect(c.guardar).not.toHaveBeenCalled(); });
});
describe('preview analysis', () => {
  it('matches the actual local result for new, replaced and identical days', async () => {
    const old=[fila, { ...fila, DNI:'TEST-102' }]; const incoming=[fila, { ...old[1]!, Horas:'8:00' }, { ...fila, DNI:'TEST-103' }];
    const preview=prepararVistaPrevia(planilla(incoming),old); const repo=crearRepositorioLocal(null); await repo.upsert(old);
    expect(preview.estimado).toEqual(await repo.upsert(preview.filas)); expect(preview.estimado).toMatchObject({ nuevas:1, actualizadas:1, sinCambios:1 }); expect(old[1]!.Horas).toBe('9:00');
  });
  it('deduplicates identical rows before persistence', () => { const p=prepararVistaPrevia(planilla([fila,fila]),[]); expect(p.repetidas).toBe(1); expect(p.filas).toHaveLength(1); expect(p.errores).toEqual([]); });
  it('blocks duplicate keys with conflicting contents', () => { expect(prepararVistaPrevia(planilla([fila,{...fila,Horas:'8:00'}]),[]).errores.join()).toContain('dos versiones distintas'); });
  it.each(['', '  ', 'X'.repeat(33), ' TEST-101'])('blocks invalid identity %s', dni => { expect(prepararVistaPrevia(planilla([{...fila,DNI:dni}]),[]).invalidas).toBe(1); });
  it.each(['31/02/2026','2026-10-09','29/02/2025','',' 09/10/2026'])('blocks invalid date %s', Fecha => { expect(prepararVistaPrevia(planilla([{...fila,Fecha}]),[]).invalidas).toBe(1); });
  it('accepts a leap date and arbitrary nonempty identity used by the server', () => { expect(prepararVistaPrevia(planilla([{...fila,Fecha:'29/02/2024'}]),[]).errores).toEqual([]); });
  it.each(['DNI','Fecha','Turno','Movimientos'])('blocks missing critical %s column', c => { expect(prepararVistaPrevia({...planilla(),columnasFaltantes:[c]},[]).errores.join()).toContain('Faltan columnas'); });
  it('allows optional fields absent for new data but blocks loss of existing evidence', () => {
    const { Horas: _omit, ...without }=fila; const p={...planilla(), filas:[without], columnasFaltantes:['Horas','Legajo']};
    expect(prepararVistaPrevia(p,[]).errores).toEqual([]); expect(prepararVistaPrevia(p,[fila]).errores.join()).toContain('borraría esos datos');
  });
  it('reports source spreadsheet row numbers', () => { expect(prepararVistaPrevia({...planilla([{...fila,Fecha:'bad'}]),numerosFila:[8]},[]).errores[0]).toContain('Fila 8'); });
});
describe('spreadsheet reader', () => {
  function excel(rows: unknown[][]) { const book=utils.book_new(); utils.book_append_sheet(book,utils.aoa_to_sheet(rows),'Fichadas'); const bytes=write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer; return {name:'test.xlsx',arrayBuffer:async()=>bytes} as File; }
  it('rejects incompatible content', async () => { await expect(leerPlanilla({name:'bad.xlsx',arrayBuffer:async()=>new ArrayBuffer(4)} as File)).rejects.toThrow('contenido no lo es'); });
  it('rejects missing identity headings before any candidate', async () => { await expect(leerPlanilla(excel([['Usuario'],['Test']]))).rejects.toThrow('no tiene'); });
  it('preserves actual row numbers after blank lines and formatted date strings', async () => {
    const p=await leerPlanilla(excel([['DNI','Fecha','Turno','Movimientos'],[],['TEST-101','09/10/2026','','']])); expect(p.numerosFila).toEqual([3]); expect(p.filas[0]?.Fecha).toBe('09/10/2026');
  });
});
