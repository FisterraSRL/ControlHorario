import { describe, expect, it } from 'vitest';

import type { ClaveNotificada } from '../../faltas/porDia.js';
import { entregarRegistrado, etiquetaNotificacion } from './notificaciones.js';

const CLAVES: readonly ClaveNotificada[] = [{ dni: '1', fechaIso: '2026-09-15', tipo: 'tardanza' }];

describe('entrega de un Word', () => {
  it('registra antes de descargar', async () => {
    const orden: string[] = [];
    const resultado = await entregarRegistrado(
      CLAVES,
      (claves) => {
        orden.push(`registrar ${claves.length}`);
        return Promise.resolve(true);
      },
      () => orden.push('descargar'),
    );
    expect(resultado).toBe('entregado');
    expect(orden).toEqual(['registrar 1', 'descargar']);
  });

  it('no descarga nada cuando el registro falla', async () => {
    let descargas = 0;
    const resultado = await entregarRegistrado(CLAVES, () => Promise.resolve(false), () => {
      descargas += 1;
    });
    expect(resultado).toBe('no_registrado');
    expect(descargas).toBe(0);
  });

  it('sin claves que registrar descarga sin llamar al servidor', async () => {
    let registros = 0;
    let descargas = 0;
    const resultado = await entregarRegistrado(
      [],
      () => {
        registros += 1;
        return Promise.resolve(true);
      },
      () => {
        descargas += 1;
      },
    );
    expect([resultado, registros, descargas]).toEqual(['entregado', 0, 1]);
  });
});

describe('estado de notificación de un día', () => {
  it('dice «Notificada» con todas, «N de M» con algunas y nada sin ninguna', () => {
    expect(etiquetaNotificacion({ notificadas: 2, total: 2 })).toBe('Notificada');
    expect(etiquetaNotificacion({ notificadas: 1, total: 2 })).toBe('1 de 2 notificadas');
    expect(etiquetaNotificacion({ notificadas: 0, total: 2 })).toBeNull();
    expect(etiquetaNotificacion({ notificadas: 0, total: 0 })).toBeNull();
  });
});
