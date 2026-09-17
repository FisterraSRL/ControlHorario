import { describe, expect, it } from 'vitest';

import {
  generarContrasenaTemporal,
  LARGO_MAXIMO_CONTRASENA,
  LARGO_MINIMO_CONTRASENA,
  validarContrasena,
} from './contrasenas.js';

describe('contraseña temporal de administración', () => {
  it('es aleatoria, apta para copiar y cumple los límites del login', () => {
    const primera = generarContrasenaTemporal();
    const segunda = generarContrasenaTemporal();

    expect(primera).not.toBe(segunda);
    expect(primera.length).toBeGreaterThanOrEqual(LARGO_MINIMO_CONTRASENA);
    expect(primera.length).toBeLessThanOrEqual(LARGO_MAXIMO_CONTRASENA);
    expect(primera).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => validarContrasena(primera)).not.toThrow();
  });
});
