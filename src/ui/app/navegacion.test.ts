/**
 * Who sees what, and where each role lands.
 *
 * Both answers come from the `roles` field of `SECCIONES`, which the sidebar and the route
 * table read. Asserting them here is asserting the one rule both of those obey.
 */

import { describe, expect, it } from 'vitest';

import { ROLES } from '../roles.js';
import { RUTA_CUENTA, SECCIONES, rutaInicialDeRol, seccionesDeRol } from './navegacion.js';

function ids(rol: 'admin' | 'operador' | 'encargado'): readonly string[] {
  return seccionesDeRol(rol).map((s) => s.id);
}

describe('secciones por rol', () => {
  it('el encargado ve solamente Ausencias y Mi cuenta', () => {
    expect(ids('encargado')).toEqual(['ausencias', 'cuenta']);
  });

  it('el administrador ve todas las secciones', () => {
    expect(ids('admin')).toEqual(SECCIONES.map((s) => s.id));
  });

  it('el operador ve todo salvo Usuarios', () => {
    expect(ids('operador')).toEqual(SECCIONES.filter((s) => s.id !== 'usuarios').map((s) => s.id));
  });

  it('todos los roles conservan Mi cuenta', () => {
    for (const rol of ROLES) expect(ids(rol)).toContain('cuenta');
  });

  it('ninguna sección queda sin rol que la abra', () => {
    for (const seccion of SECCIONES) expect(seccion.roles.length).toBeGreaterThan(0);
  });
});

describe('ruta inicial por rol', () => {
  it('RRHH sigue entrando por Cargar datos', () => {
    expect(rutaInicialDeRol('admin')).toBe('/carga');
    expect(rutaInicialDeRol('operador')).toBe('/carga');
  });

  it('el encargado no aterriza en /carga, que le responde 403', () => {
    expect(rutaInicialDeRol('encargado')).toBe('/ausencias');
    expect(rutaInicialDeRol('encargado')).not.toBe('/carga');
  });

  it('la ruta inicial de cada rol es una sección que ese rol puede abrir', () => {
    for (const rol of ROLES) {
      const inicial = rutaInicialDeRol(rol);
      expect(seccionesDeRol(rol).map((s) => s.path)).toContain(inicial);
    }
  });

  it('«Mi cuenta» existe como último recurso de la ruta inicial', () => {
    expect(SECCIONES.map((s) => s.path)).toContain(RUTA_CUENTA);
  });
});
