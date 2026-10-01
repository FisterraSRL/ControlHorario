import { describe, expect, it } from 'vitest';
import type { NotificacionPersona } from '../../../notificaciones/index.js';
import { idFaltaNotificada } from '../../faltas/porDia.js';
import { notificadasDelPeriodo, totalesDelPeriodo } from './indicador.js';

function persona(incompleta: number, descanso: number, tardanza: number, campos: Partial<NotificacionPersona> = {}): NotificacionPersona {
  const fila = { fecha:'14/09/2026', turnoRaw:'08:00 - 16:00', fechaOrden:new Date('2026-09-14T00:00:00Z') };
  return {
    usuario:'Persona', dni:'20-00000000-0', sector:'Administración',
    faltasPorTipo: {
      incompleta: Array.from({length:incompleta}, () => ({...fila, registradas:'08:02', cantidad:'2 de 4'})),
      descanso: Array.from({length:descanso}, () => ({...fila, descansoTomado:'1:15', exceso:'0:45'})),
      tardanza: Array.from({length:tardanza}, () => ({...fila, horarioFichado:'08:02', minutos:'0:12'})),
    },
    ...campos,
  };
}

describe('totales del indicador', () => {
  it('devuelve todo en cero cuando no hay nadie en el período', () => {
    expect(totalesDelPeriodo([])).toEqual({porTipo:{incompleta:0,descanso:0,tardanza:0},total:0});
  });

  it('suma cada clase de falta por separado y el total general', () => {
    expect(totalesDelPeriodo([persona(2,1,0), persona(1,0,3)])).toEqual({porTipo:{incompleta:3,descanso:1,tardanza:3},total:7});
  });

  it('cuenta a la persona sin faltas sin mover los totales', () => {
    expect(totalesDelPeriodo([persona(0,0,0), persona(1,0,0)])).toEqual({porTipo:{incompleta:1,descanso:0,tardanza:0},total:1});
  });

  it('hace coincidir el total general con la suma de las tres clases', () => {
    const totales = totalesDelPeriodo([persona(4,2,1), persona(0,3,0), persona(0,0,0)]);
    expect(totales.porTipo.incompleta + totales.porTipo.descanso + totales.porTipo.tardanza).toBe(totales.total);
  });
});

describe('faltas notificadas del indicador', () => {
  it('cuenta por persona las faltas cuya clave ya está notificada y las suma', () => {
    const ana = persona(1, 0, 2, { dni:'1', usuario:'Ana' });
    const beto = persona(0, 1, 0, { dni:'2', usuario:'Beto' });
    const notificadas = new Set([idFaltaNotificada('1', '2026-09-14', 'tardanza'), idFaltaNotificada('2', '2026-09-14', 'descanso')]);
    const resultado = notificadasDelPeriodo([ana, beto], notificadas);
    // Both of Ana's tardanzas share the day, so one key covers the two rows.
    expect([...resultado.porDni]).toEqual([['1', 2], ['2', 1]]);
    expect(resultado.total).toBe(3);
  });

  it('no cuenta una clave notificada que ya no es una falta', () => {
    // A rule fix erased the incompleta that was notified; only the current faltas count.
    const ana = persona(0, 0, 1, { dni:'1' });
    const notificadas = new Set([idFaltaNotificada('1', '2026-09-14', 'incompleta'), idFaltaNotificada('1', '2026-09-13', 'tardanza')]);
    expect(notificadasDelPeriodo([ana], notificadas)).toEqual({ porDni:new Map([['1', 0]]), total:0 });
  });

  it('lista en cero a quien no tiene nada notificado, y nunca supera el total de faltas', () => {
    const limpia = persona(0, 0, 0, { dni:'3' });
    const ana = persona(2, 0, 0, { dni:'1' });
    const resultado = notificadasDelPeriodo([limpia, ana], new Set([idFaltaNotificada('1', '2026-09-14', 'incompleta')]));
    expect(resultado.porDni.get('3')).toBe(0);
    expect(resultado.total).toBeLessThanOrEqual(totalesDelPeriodo([limpia, ana]).total);
    expect(resultado.total).toBe(2);
  });
});
