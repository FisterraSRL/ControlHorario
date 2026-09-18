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

  /**
   * `listar` descarta las filas que este parser devuelve nulas. Un rol desconocido no se
   * vería como "rol raro": haría desaparecer la cuenta de la única pantalla que puede
   * desactivarla.
   */
  it('acepta un encargado con sus sectores', () => {
    const fila = leerUsuarioAdministrado({
      ...BASE, id: '3', rol: 'encargado', sectores: ['Depósito', 'Producción'],
    });
    expect(fila?.rol).toBe('encargado');
    expect(fila?.sectores).toEqual(['Depósito', 'Producción']);
  });

  it('deja los sectores vacíos cuando la fila no los trae', () => {
    expect(leerUsuarioAdministrado({ ...BASE, id: '4' })?.sectores).toEqual([]);
  });

  it('rechaza un rol que no existe', () => {
    expect(leerUsuarioAdministrado({ ...BASE, id: '5', rol: 'supervisor' })).toBeNull();
  });
});
