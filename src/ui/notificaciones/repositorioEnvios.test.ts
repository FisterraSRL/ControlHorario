import { describe, expect, it } from 'vitest';
import { clavesSnapshot, esSnapshot, personaDe, snapshotDe, type PedidoEmision } from '../../notificaciones/envios.js';
import { PERSONA_MIXTA } from '../../notificaciones/__fixtures__/personas.js';
import { generarWord } from '../../notificaciones/documentoWord.js';
import { CLAVE_ENVIOS, crearRepositoriosEnviosLocal } from './repositorioEnviosLocal.js';

const snapshot = snapshotDe(PERSONA_MIXTA);
const id = '10000000-0000-4000-8000-000000000001';
const id2 = '10000000-0000-4000-8000-000000000002';
const pedido: PedidoEmision = { id: '20000000-0000-4000-8000-000000000001', documentos: [id], fechaDocumento: '2026-10-06' };
function almacen(): Storage {
  const datos = new Map<string, string>();
  return { get length() { return datos.size; }, key: i => [...datos.keys()][i] ?? null, getItem: k => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: k => { datos.delete(k); }, clear: () => datos.clear() };
}
const todas = (r: ReturnType<typeof crearRepositoriosEnviosLocal>) => r.notificaciones.listar('2000-01-01', '2099-12-31');
describe('notification queue and history', () => {
  it('enqueue and discard never mark faults; queue survives reload', async () => {
    const storage = almacen(); const r = crearRepositoriosEnviosLocal(storage);
    await r.envios.encolar([{ id, snapshot }]);
    expect(await todas(r)).toEqual([]);
    const recargado = crearRepositoriosEnviosLocal(storage);
    expect(await recargado.envios.pendientes()).toHaveLength(1);
    await recargado.envios.descartar(id);
    expect(await r.envios.pendientes()).toEqual([]);
    expect(await todas(r)).toEqual([]);
    expect((await r.envios.historial(0)).documentos).toEqual([]);
  });
  it('emits exactly the requested documents and preserves other pending items', async () => {
    const r = crearRepositoriosEnviosLocal(null);
    await r.envios.encolar([{ id, snapshot }, { id: id2, snapshot: { ...snapshot, dni: 'another' } }]);
    const docs = await r.envios.emitir(pedido);
    expect(docs.map(d => d.id)).toEqual([id]);
    expect(await todas(r)).toHaveLength(clavesSnapshot(snapshot).length);
    expect((await r.envios.pendientes()).map(d => d.id)).toEqual([id2]);
  });
  it('a retry returns one durable emission without new marks or timestamps', async () => {
    const storage = almacen(); const r = crearRepositoriosEnviosLocal(storage);
    await r.envios.encolar([{ id, snapshot }]);
    const primera = await r.envios.emitir(pedido);
    const recargado = crearRepositoriosEnviosLocal(storage);
    expect(await recargado.envios.emitir(pedido)).toEqual(primera);
    expect((await recargado.envios.historial(0)).documentos).toHaveLength(1);
    await expect(recargado.envios.emitir({ ...pedido, documentos: [id2] })).rejects.toThrow('otra selección');
  });
  it('a conflicting operator action fails the whole emission', async () => {
    const r = crearRepositoriosEnviosLocal(null);
    await r.envios.encolar([{ id, snapshot }]);
    await expect(r.envios.emitir({ ...pedido, documentos: [id, id2] })).rejects.toThrow('Otro operador');
    expect(await todas(r)).toEqual([]);
    expect(await r.envios.pendientes()).toHaveLength(1);
    expect((await r.envios.historial(0)).documentos).toEqual([]);
  });
  it('overlapping queued selections are rejected atomically', async () => {
    const r = crearRepositoriosEnviosLocal(null);
    await r.envios.encolar([{ id, snapshot }]);
    await expect(r.envios.encolar([{ id: id2, snapshot }])).rejects.toThrow('ya está');
    expect(await r.envios.pendientes()).toHaveLength(1);
    await r.envios.encolar([{ id, snapshot }]);
    expect(await r.envios.pendientes()).toHaveLength(1);
  });
  it('an enqueue retry cannot resurrect discarded documents', async () => {
    const r = crearRepositoriosEnviosLocal(null);
    await r.envios.encolar([{ id, snapshot }]); await r.envios.descartar(id);
    await r.envios.encolar([{ id, snapshot }]);
    expect(await r.envios.pendientes()).toEqual([]);
  });
  it('removes one exact mark and keeps the immutable document and other marks', async () => {
    const r = crearRepositoriosEnviosLocal(almacen());
    await r.envios.encolar([{ id, snapshot }]); const [doc] = await r.envios.emitir(pedido);
    await r.envios.quitar([doc!.activas[0]!]);
    const historial = await r.envios.historial(0);
    expect(historial.documentos[0]!.snapshot).toEqual(snapshot);
    expect(historial.documentos[0]!.activas).toHaveLength(clavesSnapshot(snapshot).length - 1);
    expect(await todas(r)).toHaveLength(clavesSnapshot(snapshot).length - 1);
    // A delivery retry must not restore a mark deliberately removed afterwards.
    await r.envios.emitir(pedido);
    expect(await todas(r)).toHaveLength(clavesSnapshot(snapshot).length - 1);
  });
  it('an old document cannot remove notifications from a later emission', async () => {
    const r = crearRepositoriosEnviosLocal(null);
    await r.envios.encolar([{ id, snapshot }]); const [antes] = await r.envios.emitir(pedido);
    await r.envios.encolar([{ id: id2, snapshot }]); const [despues] = await r.envios.emitir({ ...pedido, id: crypto.randomUUID(), documentos: [id2] });
    await r.envios.quitar(antes!.activas);
    expect(await todas(r)).toHaveLength(despues!.activas.length);
    expect((await r.envios.historial(0)).documentos.find(d => d.id === id)!.activas).toEqual([]);
  });
  it('quota failure leaves queue, marks and history together in their previous state', async () => {
    const storage = almacen(); const r = crearRepositoriosEnviosLocal(storage);
    await r.envios.encolar([{ id, snapshot }]);
    const antes = storage.getItem(CLAVE_ENVIOS);
    storage.setItem = () => { throw new Error('quota'); };
    await expect(r.envios.emitir(pedido)).rejects.toThrow('quota');
    expect(storage.getItem(CLAVE_ENVIOS)).toBe(antes);
    expect(await todas(r)).toEqual([]);
    expect(await r.envios.pendientes()).toHaveLength(1);
  });
  it('imports legacy marks once and allows removing them without inventing a document', async () => {
    const storage = almacen(); storage.setItem('controlhorario.notificadas.v1', JSON.stringify({ '123|2026-09-01|tardanza': '2026-10-01T12:00:00Z' }));
    const r = crearRepositoriosEnviosLocal(storage); const h = await r.envios.historial(0);
    expect(h.documentos).toEqual([]); expect(h.anteriores).toHaveLength(1);
    await r.envios.quitar(h.anteriores);
    expect((await crearRepositoriosEnviosLocal(storage).envios.historial(0)).anteriores).toEqual([]);
  });
});
describe('immutable letter snapshots', () => {
  it('round trips dates and produces identical document bytes with a fixed issue date', () => {
    const opts = { hoy: new Date('2026-10-06T12:00:00Z') };
    expect(personaDe(JSON.parse(JSON.stringify(snapshot)))).toEqual(PERSONA_MIXTA);
    expect(generarWord(personaDe(snapshot), opts)!.bytes).toEqual(generarWord(PERSONA_MIXTA, opts)!.bytes);
  });
  it('rejects missing/unknown fields, invalid dates, repeated keys and empty documents', () => {
    expect(esSnapshot({ ...snapshot, unexpected: true })).toBe(false);
    const fila = snapshot.faltasPorTipo.tardanza[0]!;
    for (const filas of [[], [{ ...fila, fechaOrden: '2026-02-30' }], [fila, fila], [{ ...fila, unexpected: true }]]) {
      expect(esSnapshot({ ...snapshot, faltasPorTipo: { incompleta: [], descanso: [], tardanza: filas } })).toBe(false);
    }
  });
});
