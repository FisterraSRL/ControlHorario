import { describe, expect, it } from 'vitest';
import type { NotificacionPersona } from '../../../notificaciones/index.js';
import { totalesDelPeriodo } from './indicador.js';

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
