import { describe, expect, it } from 'vitest';

import { appConSesion, crearPoolFalso, sesionDePrueba } from './pruebas/dobles.js';
import { crearRepositorioCierre } from './repositorioCierre.js';
import { registrarRutasCierre } from './rutasCierre.js';

const rutaIrregularidades = '/api/cierre/irregularidades';
const clave = { dni: '00001', fecha: '2026-11-12', tipo: 'incompleta' };

function iniciar(pool: ReturnType<typeof crearPoolFalso>, sesion = sesionDePrueba()) {
  return appConSesion(sesion, (app) => registrarRutasCierre(app, crearRepositorioCierre(pool)));
}

describe('API del cierre de novedades', () => {
  it('uses the default cutoff until an administrator saves one', async () => {
    const pool = crearPoolFalso();
    const app = await iniciar(pool, sesionDePrueba({ rol: 'admin' }));
    try {
      expect((await app.inject('/api/cierre/corte')).json()).toEqual({ dia: 25 });
      const res = await app.inject({ method: 'PUT', url: '/api/cierre/corte', payload: { dia: 31 } });
      expect(res.statusCode).toBe(204);
      expect(pool.llamadas[1]?.valores).toEqual(['dia_corte_novedades', '31', 'rrhh@ejemplo.test']);
      expect(pool.cierres).toEqual(['commit']);
    } finally { await app.close(); }
  });

  it('allows a supervisor to read the saved cutoff and refuses updates', async () => {
    const pool = crearPoolFalso(() => ({ rows: [{ valor: 19 }] }));
    const app = await iniciar(pool, sesionDePrueba({ rol: 'encargado' }));
    try {
      expect((await app.inject('/api/cierre/corte')).json()).toEqual({ dia: 19 });
      const res = await app.inject({ method: 'PUT', url: '/api/cierre/corte', payload: { dia: 25 } });
      expect(res.statusCode).toBe(403);
      expect(pool.llamadas).toHaveLength(1);
    } finally { await app.close(); }
  });

  it('reads reviews inside both the date window and the assigned sectors', async () => {
    const pool = crearPoolFalso();
    const app = await iniciar(pool, sesionDePrueba({ rol: 'encargado', sectores: ['Producción'] }));
    try {
      const res = await app.inject(`${rutaIrregularidades}?desde=2026-10-26&hasta=2026-11-25`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ revisiones: [] });
      expect(pool.llamadas[0]?.valores).toEqual(['2026-10-26', '2026-11-25', '["Producción"]']);
      expect(pool.textos()[0]).toContain("JSON_VALUE(f.[payload], '$.Sector') IN");
    } finally { await app.close(); }
  });

  it('rejects a request outside scope before saving or auditing', async () => {
    const pool = crearPoolFalso();
    const app = await iniciar(pool, sesionDePrueba({ rol: 'encargado', sectores: [] }));
    try {
      const res = await app.inject({ method: 'PUT', url: rutaIrregularidades, payload: { ...clave, decision: null } });
      expect(res.statusCode).toBe(403);
      expect(pool.llamadas).toHaveLength(1);
      expect(pool.llamadas[0]?.valores).toEqual([clave.dni, clave.fecha, '[]']);
      expect(pool.textos()[0]).toContain('WITH (UPDLOCK, HOLDLOCK)');
    } finally { await app.close(); }
  });

  it('saves the justification and audits only the decision code in one transaction', async () => {
    const pool = crearPoolFalso(() => ({ rows: [{ presente: 1 }] }));
    const app = await iniciar(pool);
    try {
      const res = await app.inject({ method: 'PUT', url: rutaIrregularidades,
        payload: { ...clave, decision: { estado: 'justificada', nota: '  Motivo ficticio  ' } } });
      expect(res.statusCode).toBe(204);
      expect(pool.llamadas[1]?.valores).toEqual([clave.dni, clave.fecha, clave.tipo, 'justificada', 'Motivo ficticio']);
      expect(pool.llamadas[2]?.valores[4]).toBe('{"tipo":"incompleta","estado":"justificada"}');
      expect(pool.llamadas.every((llamada) => llamada.enTransaccion)).toBe(true);
      expect(pool.cierres).toEqual(['commit']);
    } finally { await app.close(); }
  });

  it('returns a review to pending without retaining its justification', async () => {
    const pool = crearPoolFalso(() => ({ rows: [{ presente: 1 }] }));
    const app = await iniciar(pool);
    try {
      const res = await app.inject({ method: 'PUT', url: rutaIrregularidades, payload: { ...clave, decision: null } });
      expect(res.statusCode).toBe(204);
      expect(pool.textos()[1]).toContain('DELETE FROM [controlhorario].[irregularidades_revisadas]');
      expect(pool.llamadas[2]?.valores[4]).toBe('{"tipo":"incompleta","estado":null}');
    } finally { await app.close(); }
  });

  it('rejects invalid cutoff, calendar date, or a blank justification without touching SQL', async () => {
    const pool = crearPoolFalso();
    const app = await iniciar(pool, sesionDePrueba({ rol: 'admin' }));
    try {
      const cutoff = await app.inject({ method: 'PUT', url: '/api/cierre/corte', payload: { dia: 32 } });
      const date = await app.inject(`${rutaIrregularidades}?desde=2026-02-30&hasta=2026-03-25`);
      const note = await app.inject({ method: 'PUT', url: rutaIrregularidades,
        payload: { ...clave, decision: { estado: 'justificada', nota: '  ' } } });
      expect([cutoff, date, note].map((res) => res.statusCode)).toEqual([400, 400, 400]);
      expect(pool.llamadas).toEqual([]);
    } finally { await app.close(); }
  });
});
