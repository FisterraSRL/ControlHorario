import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { alcanceDeSectores } from './autenticacion.js';
import { sesionDePrueba } from './pruebas/dobles.js';
import type { Sesion } from './sesiones.js';

/** The two fields `alcanceDeSectores` reads, in the shape a handler receives them. */
function peticionCon(sesion?: Sesion): FastifyRequest {
  return { sesion } as unknown as FastifyRequest;
}

describe('alcance de sectores de una sesión', () => {
  it('un admin no tiene restricción', () => {
    expect(alcanceDeSectores(peticionCon(sesionDePrueba({ rol: 'admin' })))).toBeNull();
  });

  it('un operador tampoco', () => {
    expect(alcanceDeSectores(peticionCon(sesionDePrueba({ rol: 'operador' })))).toBeNull();
  });

  it('ignora los sectores de una cuenta de RRHH', () => {
    // A stray row in `usuarios_sectores` must not narrow an operator's view, and it must not
    // widen it either: the role decides, the table only says how far.
    const sesion = sesionDePrueba({ rol: 'operador', sectores: ['Cocina'] });
    expect(alcanceDeSectores(peticionCon(sesion))).toBeNull();
  });

  it('un encargado queda limitado a sus sectores', () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina', 'Reparto'] });
    expect(alcanceDeSectores(peticionCon(sesion))).toEqual(['Cocina', 'Reparto']);
  });

  it('un encargado sin sectores no ve nada, no ve todo', () => {
    // The whole point of the `null` / `[]` distinction. An empty array is a restriction to
    // nothing; returning `null` here would hand the entire company to an account that was
    // never given a single sector.
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: [] });
    expect(alcanceDeSectores(peticionCon(sesion))).toEqual([]);
    expect(alcanceDeSectores(peticionCon(sesion))).not.toBeNull();
  });

  it('una petición sin sesión falla en vez de responder "sin restricción"', () => {
    expect(() => alcanceDeSectores(peticionCon(undefined))).toThrow(/sin sesión/);
  });
});
