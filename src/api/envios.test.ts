import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshotDe } from '../notificaciones/envios.js';
import { PERSONA_MIXTA } from '../notificaciones/__fixtures__/personas.js';
import { appConSesion, crearPoolFalso, sesionDePrueba } from './pruebas/dobles.js';
import { crearRepositorioEnvios, type RepositorioEnviosSql } from './repositorioEnvios.js';
import { registrarRutasEnvios } from './rutasEnvios.js';

const id = '10000000-0000-4000-8000-000000000001';
const snapshot = snapshotDe(PERSONA_MIXTA);
const emision = { id: '20000000-0000-4000-8000-000000000001', documentos: [id], fechaDocumento: '2026-10-06' };
let app: FastifyInstance;
afterEach(async () => { await app?.close(); });
function espia(): RepositorioEnviosSql {
  return { pendientes: vi.fn(async () => []), encolar: vi.fn(async () => {}), descartar: vi.fn(async () => {}), emitir: vi.fn(async () => []), historial: vi.fn(async () => ({ documentos: [], anteriores: [], hayMas: false })), quitar: vi.fn(async () => {}) };
}
const rutas = [
  { method: 'GET' as const, url: '/api/envios/pendientes' },
  { method: 'GET' as const, url: '/api/envios/historial' },
  { method: 'POST' as const, url: '/api/envios/pendientes', payload: { documentos: [{ id, snapshot }] } },
  { method: 'POST' as const, url: '/api/envios/descartar', payload: { id } },
  { method: 'POST' as const, url: '/api/envios/emitir', payload: emision },
  { method: 'POST' as const, url: '/api/envios/quitar-notificado', payload: { marcas: [] } },
];
describe('queue routes', () => {
  it.each(rutas)('denies encargado before persistence: $method $url', async ruta => {
    const repo = espia(); app = await appConSesion(sesionDePrueba({ rol: 'encargado' }), a => registrarRutasEnvios(a, repo));
    expect((await app.inject(ruta)).statusCode).toBe(403);
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
  });
  it('queues as the authenticated operator without marking faults', async () => {
    const repo = espia(); app = await appConSesion(sesionDePrueba(), a => registrarRutasEnvios(a, repo));
    expect((await app.inject(rutas[2]!)).statusCode).toBe(200);
    expect(repo.encolar).toHaveBeenCalledWith([{ id, snapshot }], 'rrhh@ejemplo.test');
    expect(repo.emitir).not.toHaveBeenCalled();
  });
  it('rejects malformed snapshots, unknown fields and duplicate ids before a write', async () => {
    const repo = espia(); app = await appConSesion(sesionDePrueba(), a => registrarRutasEnvios(a, repo));
    for (const documentos of [[{ id, snapshot: { ...snapshot, extra: true } }], [{ id, snapshot }, { id, snapshot }], [{ id: 'bad', snapshot }]]) {
      expect((await app.inject({ method: 'POST', url: '/api/envios/pendientes', payload: { documentos } })).statusCode).toBe(400);
    }
    expect(repo.encolar).not.toHaveBeenCalled();
  });
  it('rejects invalid issue dates and repeated document ids', async () => {
    const repo = espia(); app = await appConSesion(sesionDePrueba(), a => registrarRutasEnvios(a, repo));
    for (const payload of [{ ...emision, fechaDocumento: '2026-02-30' }, { ...emision, documentos: [id, id] }]) expect((await app.inject({ method: 'POST', url: '/api/envios/emitir', payload })).statusCode).toBe(400);
    expect(repo.emitir).not.toHaveBeenCalled();
  });
  it('explains removed evidence and preserves the migration failure signal', async () => {
    const repo = espia(); repo.emitir = async () => { throw { number: 547 }; }; repo.pendientes = async () => { throw { number: 208 }; };
    app = await appConSesion(sesionDePrueba(), a => registrarRutasEnvios(a, repo));
    const res = await app.inject({ method: 'POST', url: '/api/envios/emitir', payload: emision });
    expect(res.statusCode).toBe(409); expect(res.json().mensaje).toContain('Descartá');
    const read = await app.inject({ method: 'GET', url: '/api/envios/pendientes' });
    expect(read.statusCode).toBe(503); expect(read.json().error).toBe('base_sin_migrar');
  });
});
describe('SQL orchestration (doubles, not SQL execution)', () => {
  const fila = { id, snapshot: JSON.stringify(snapshot), creado_at: '2026-10-06T12:00:00Z', emision_id: null };
  it('serializes queue mutation and audits it in one transaction', async () => {
    const pool = crearPoolFalso(); await crearRepositorioEnvios(pool).encolar([{ id, snapshot }], 'operator');
    expect(pool.llamadas.every(l => l.enTransaccion)).toBe(true);
    expect(pool.llamadas[0]!.texto).toContain('UPDLOCK, HOLDLOCK');
    expect(pool.textos().join(' ')).toContain('INSERT INTO [controlhorario].[documentos_notificacion]');
    expect(pool.textos().join(' ')).not.toContain('MERGE'); expect(pool.cierres).toEqual(['commit']);
  });
  it('marks and emits together with ownership/version on every fault', async () => {
    const pool = crearPoolFalso(sql => sql.includes('d.[descartado_at] IS NULL') ? { rows: [fila] } : undefined);
    await crearRepositorioEnvios(pool).emitir(emision, 'operator');
    expect(pool.cierres).toEqual(['commit']);
    expect(pool.llamadas.every(l => l.enTransaccion)).toBe(true);
    const merge = pool.llamadas.find(l => l.texto.includes('MERGE'))!;
    const marcas = JSON.parse(merge.valores[0] as string) as { version: string; documento: string }[];
    expect(marcas).toHaveLength(4); expect(marcas.every(m => m.documento === id && m.version.length === 36)).toBe(true);
    expect(merge.texto).toContain('WHEN MATCHED THEN UPDATE');
  });
  it('rolls back without an audit when evidence disappeared', async () => {
    const pool = crearPoolFalso(sql => {
      if (sql.includes('d.[descartado_at] IS NULL')) return { rows: [fila] };
      if (sql.includes('MERGE')) return Object.assign(new Error('FK'), { number: 547 });
      return undefined;
    });
    await expect(crearRepositorioEnvios(pool).emitir(emision, 'operator')).rejects.toThrow('FK');
    expect(pool.cierres).toEqual(['rollback']);
    expect(pool.textos().join(' ')).not.toContain('INSERT INTO [controlhorario].[auditoria]');
  });
  it('a committed retry neither rewrites marks nor creates another emission', async () => {
    const pool = crearPoolFalso(sql => sql.startsWith('SELECT [documentos]') ? { rows: [{ documentos: JSON.stringify([id]), fecha_documento: emision.fechaDocumento }] } : undefined);
    await crearRepositorioEnvios(pool).emitir(emision, 'operator');
    expect(pool.textos().join(' ')).not.toMatch(/INSERT|UPDATE SET|MERGE/);
    expect(pool.cierres).toEqual(['commit']);
  });
  it('removal compares version and audits only actually removed versions', async () => {
    const pool = crearPoolFalso(sql => sql.startsWith('DELETE') ? { rows: [{ version: id }] } : undefined);
    await crearRepositorioEnvios(pool).quitar([{ dni: '123', fechaIso: '2026-10-01', tipo: 'tardanza', version: id, notificadoAt: '2026-10-06T12:00:00Z' }], 'operator');
    expect(pool.textos().join(' ')).toContain('n.[version] = p.[version]');
    const audit = pool.llamadas.find(l => l.texto.includes('INSERT INTO [controlhorario].[auditoria]'))!;
    expect(JSON.parse(audit.valores[4] as string)).toEqual({ versiones: [id], quitadas: 1 });
    expect(pool.cierres).toEqual(['commit']);
  });
});
