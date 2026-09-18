/**
 * The login guard.
 *
 * This is the test that would have caught the worst failure mode of the encargado role:
 * `iniciar()` turns a body this guard rejects into "el correo o la contraseña no son
 * correctos", so a role the guard does not know about locks a person with the right
 * password out of the app and sends them to reset a password that was never wrong.
 */

import { describe, expect, it } from 'vitest';

import { aSesion, esCuerpoSesion } from './repositorioSesionHttp.js';

const CUERPO = {
  usuario: { email: 'persona@ejemplo.test', nombre: 'Persona de prueba', rol: 'operador' },
  expiraAt: '2026-09-18T12:00:00.000Z',
} as const;

function conUsuario(usuario: Record<string, unknown>): Record<string, unknown> {
  return { ...CUERPO, usuario: { ...CUERPO.usuario, ...usuario } };
}

describe('respuesta de sesión', () => {
  it('acepta el cuerpo de un encargado', () => {
    const cuerpo = conUsuario({ rol: 'encargado', sectores: ['Depósito'] });
    expect(esCuerpoSesion(cuerpo)).toBe(true);
  });

  it('acepta los tres roles', () => {
    for (const rol of ['admin', 'operador', 'encargado']) {
      expect(esCuerpoSesion(conUsuario({ rol }))).toBe(true);
    }
  });

  it('rechaza un rol que no existe', () => {
    expect(esCuerpoSesion(conUsuario({ rol: 'supervisor' }))).toBe(false);
  });

  it('rechaza un cuerpo sin usuario, que es lo que devuelve un 401', () => {
    expect(esCuerpoSesion({ error: 'credenciales', mensaje: 'No coincide.' })).toBe(false);
  });

  it('lleva los sectores del encargado hasta el operador de la sesión', () => {
    const cuerpo = conUsuario({ rol: 'encargado', sectores: ['Depósito', 'Producción'] });
    if (!esCuerpoSesion(cuerpo)) throw new Error('el cuerpo del encargado tiene que pasar el guard');
    expect(aSesion(cuerpo).operador.sectores).toEqual(['Depósito', 'Producción']);
  });

  it('deja los sectores vacíos cuando el servidor no los manda', () => {
    const cuerpo = conUsuario({ rol: 'admin' });
    if (!esCuerpoSesion(cuerpo)) throw new Error('el cuerpo de un admin tiene que pasar el guard');
    const sesion = aSesion(cuerpo);
    expect(sesion.operador.sectores).toEqual([]);
    expect(sesion.autenticada).toBe(true);
  });

  it('ignora un sectores que no es una lista de textos en vez de rechazar la sesión', () => {
    const cuerpo = conUsuario({ rol: 'encargado', sectores: 'Depósito' });
    if (!esCuerpoSesion(cuerpo)) throw new Error('un sectores inválido no puede voltear el login');
    expect(aSesion(cuerpo).operador.sectores).toEqual([]);
  });
});
