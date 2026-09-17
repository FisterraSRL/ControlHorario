import { describe, expect, it } from 'vitest';

import { leerUsuarioAdministrado } from './repositorioUsuariosHttp.js';

const BASE = {
  email: 'persona@ejemplo.test',
  nombre: 'Persona de prueba',
  rol: 'operador',
  activo: true,
  creadoAt: '2026-09-17T12:00:00.000Z',
} as const;

describe('respuesta de administración de usuarios', () => {
  it('acepta el bigint que Azure SQL serializa como texto', () => {
    expect(leerUsuarioAdministrado({ ...BASE, id: '1' })?.id).toBe('1');
  });

  it('normaliza un identificador numérico seguro por compatibilidad', () => {
    expect(leerUsuarioAdministrado({ ...BASE, id: 2 })?.id).toBe('2');
  });

  it('rechaza identificadores que no son enteros positivos', () => {
    expect(leerUsuarioAdministrado({ ...BASE, id: '0' })).toBeNull();
    expect(leerUsuarioAdministrado({ ...BASE, id: '1 OR 1=1' })).toBeNull();
  });
});
