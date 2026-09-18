/**
 * The invariant this file exists to protect: `operador` is HIDDEN, not removed.
 *
 * The alta form stopped offering it because the product has two kinds of account — the
 * company and its clients. But `rol` defaults to `N'operador'` in the database, the
 * `crearUsuario` CLI relies on that default and the offline adapter signs in as one, so the
 * app still has to understand a role it no longer hands out. The day somebody "cleans up"
 * `RolUsuario` by deleting the member, these tests fail instead of the login screen telling
 * a person with the right password that their password is wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  ETIQUETAS_ROL,
  ROLES,
  ROLES_ASIGNABLES,
  esRolAsignable,
  esRolUsuario,
} from './roles.js';

describe('roles', () => {
  it('sigue entendiendo el rol operador aunque ya no se reparta', () => {
    expect(esRolUsuario('operador')).toBe(true);
    expect(ROLES).toContain('operador');
  });

  it('no ofrece operador en el alta', () => {
    expect(ROLES_ASIGNABLES).not.toContain('operador');
    expect(esRolAsignable('operador')).toBe(false);
  });

  it('ofrece exactamente administrador y encargado', () => {
    expect(ROLES_ASIGNABLES).toEqual(['admin', 'encargado']);
    expect(esRolAsignable('admin')).toBe(true);
    expect(esRolAsignable('encargado')).toBe(true);
  });

  it('no asigna un rol que el sistema no reconoce', () => {
    expect(esRolAsignable('gerente')).toBe(false);
    expect(esRolAsignable(null)).toBe(false);
  });

  it('todo rol asignable es un rol válido', () => {
    for (const rol of ROLES_ASIGNABLES) expect(esRolUsuario(rol)).toBe(true);
  });

  it('conserva la etiqueta de operador, porque esas cuentas se siguen listando', () => {
    expect(ETIQUETAS_ROL.operador).toBe('Operador');
  });
});
