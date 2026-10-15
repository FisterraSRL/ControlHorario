import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearRepositorioAusenciasHttp } from './repositorioAusenciasHttp.js';
const fila = { dni: '0001', fecha: '2026-10-15', motivoId: 99, motivoSource: 'manual', motivoLabel: 'Motivo retirado', resueltoPor: null, resueltoAt: null, adjuntos: 0 };
function responder(ausencias: unknown[]) { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ausencias }), { headers: { 'Content-Type': 'application/json' } }))); }
afterEach(() => vi.unstubAllGlobals());
describe('complete absence registry for evidence export', () => {
  it('retains retired reason labels without losing leading-zero identities', async () => {
    responder([fila]);
    expect(await crearRepositorioAusenciasHttp('/api').listar()).toEqual([fila]);
  });
  it('accepts older server responses without optional labels', async () => {
    const { motivoLabel: _label, ...anterior } = fila;
    responder([anterior]);
    expect(await crearRepositorioAusenciasHttp('/api').listar()).toEqual([anterior]);
  });
  it.each([{ ...fila, motivoLabel: 123 }, { ...fila, motivoId: '99' }, { ...fila, motivoSource: 'desconocido' }, { ...fila, motivoSource: ['manual'] }])('rejects the entire registry on malformed rows instead of silently exporting raw notes', async (invalida) => {
    responder([fila, invalida]);
    await expect(crearRepositorioAusenciasHttp('/api').listar()).rejects.toThrow('formato inesperado');
  });
});
