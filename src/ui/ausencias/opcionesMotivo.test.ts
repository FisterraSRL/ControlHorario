import { describe, expect, it } from 'vitest';

import { avisoMotivo, opcionesMotivo } from './opcionesMotivo.js';

describe('opciones del desplegable de motivo', () => {
  it('empieza por «Sin clasificar» y sigue el orden de los motivos', () => {
    expect(
      opcionesMotivo([
        { id: 4, label: 'Enfermedad', worked: false },
        { id: 2, label: 'Capacitación', worked: true },
      ]),
    ).toEqual([
      { valor: '', label: 'Sin clasificar' },
      { valor: '4', label: 'Enfermedad' },
      { valor: '2', label: 'Capacitación' },
    ]);
  });

  it('confirma con palabras distintas asignar y quitar', () => {
    expect(avisoMotivo(4)).toBe('Motivo asignado.');
    expect(avisoMotivo(null)).toBe('Se quitó la clasificación.');
  });
});
