/**
 * The alta form's rules.
 *
 * They mirror what `POST /api/admin/usuarios` enforces inside its transaction. The point of
 * testing them here is that the account cannot be edited afterwards: an encargado created
 * with the wrong sectors is fixed by deactivating the account and creating another one.
 */

import { describe, expect, it } from 'vitest';

import type { BorradorUsuario } from './usuarios.js';
import { problemaDelAlta, sectoresAsignables, sectoresParaCrear } from './usuarios.js';

const SECTORES = ['Depósito', 'Producción'];

function borrador(cambios: Partial<BorradorUsuario> = {}): BorradorUsuario {
  return {
    nombre: 'Persona de prueba',
    email: 'persona@ejemplo.test',
    rol: 'operador',
    sectores: [],
    ...cambios,
  };
}

describe('sectores que se pueden asignar', () => {
  it('une los del historial con los que ya tienen regla en Configuración', () => {
    expect(sectoresAsignables({ Administración: 2 }, ['Depósito'])).toEqual([
      'Administración',
      'Depósito',
    ]);
  });

  it('no inventa sectores cuando no hay planilla ni reglas', () => {
    expect(sectoresAsignables({}, [])).toEqual([]);
  });
});

describe('sectores que viajan en el alta', () => {
  it('sólo el encargado los lleva', () => {
    expect(sectoresParaCrear('encargado', ['Depósito'])).toEqual(['Depósito']);
    expect(sectoresParaCrear('operador', ['Depósito'])).toEqual([]);
    expect(sectoresParaCrear('admin', ['Depósito'])).toEqual([]);
  });

  it('no repite un sector elegido dos veces', () => {
    expect(sectoresParaCrear('encargado', ['Depósito', 'Depósito'])).toEqual(['Depósito']);
  });
});

describe('validación del alta', () => {
  it('deja crear un operador sin tocar sectores', () => {
    expect(problemaDelAlta(borrador(), SECTORES)).toBeNull();
  });

  it('pide nombre y correo antes que cualquier otra cosa', () => {
    expect(problemaDelAlta(borrador({ nombre: '   ' }), SECTORES)).toBe(
      'Completá un nombre y un correo válido.',
    );
    expect(problemaDelAlta(borrador({ email: 'sin-arroba' }), SECTORES)).toBe(
      'Completá un nombre y un correo válido.',
    );
  });

  it('bloquea al encargado sin ningún sector elegido', () => {
    expect(problemaDelAlta(borrador({ rol: 'encargado' }), SECTORES)).toBe(
      'Un encargado tiene que supervisar al menos un sector.',
    );
  });

  it('deja crear al encargado con al menos un sector', () => {
    expect(problemaDelAlta(borrador({ rol: 'encargado', sectores: ['Depósito'] }), SECTORES)).toBeNull();
  });

  it('bloquea al encargado cuando todavía no hay sectores cargados', () => {
    // Sin planilla no hay lista para elegir, y un sector tipeado a mano dejaría la cuenta
    // sin alcance sin que nadie se entere.
    expect(problemaDelAlta(borrador({ rol: 'encargado' }), [])).toContain('Todavía no hay sectores');
  });

  it('bloquea un sector que ya no figura en los datos cargados', () => {
    expect(problemaDelAlta(borrador({ rol: 'encargado', sectores: ['Taller'] }), SECTORES)).toBe(
      'El sector «Taller» ya no figura en los datos cargados.',
    );
  });

  it('ignora los sectores tildados si después se cambia el rol', () => {
    expect(problemaDelAlta(borrador({ rol: 'operador', sectores: ['Taller'] }), SECTORES)).toBeNull();
  });
});
