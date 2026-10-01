import { describe, expect, it } from 'vitest';
import type { RegistroDia } from '../../domain/fichadas/index.js';
import { totalDeFaltas } from '../../notificaciones/index.js';
import { agruparFaltasPorPersona } from './agrupacion.js';
import { clavesNotificadas, contarNotificadas, idDeFalta, idFaltaNotificada, separarPorDia } from './porDia.js';

const RANGO = { desde: new Date('2026-09-14T00:00:00Z'), hasta: new Date('2026-09-20T00:00:00Z') };

function dia(campos: Partial<RegistroDia> = {}): RegistroDia {
  return { sector:'Administración', usuario:'Persona', dni:'20-00000000-0', legajo:'1', fecha:new Date('2026-09-14T00:00:00Z'), fechaStr:'14/09/2026', inicioSemana:'2026-09-14', cantidadMovimientos:2, movimientos:[480,960], turnoRaw:'08:00 - 16:00', esDiaLibre:false, esFlexible:false, inicioTurno:480, fichadasRequeridas:2, horasTurno:480, horasBrutas:480, cantidadTarde:0, partesRaw:'', descansoReal:0, faltas:[], tipoDia:'trabajo', motivoId:null, motivoSource:null, excluido:false, ...campos };
}

function el(fechaStr: string, faltas: RegistroDia['faltas']): RegistroDia {
  return dia({ fechaStr, fecha: new Date(`${fechaStr.split('/').reverse().join('-')}T00:00:00Z`), faltas });
}

const TARDE = { tipo:'tardanza' as const, detalle:'Llegó tarde' };
const DESCANSO = { tipo:'descanso' as const, detalle:'Descanso excedido' };
const INCOMPLETA = { tipo:'incompleta' as const, detalle:'Faltan fichadas' };

/** Three days out of order; the 16th carries two kinds of falta at once. */
const REGISTROS = [
  el('17/09/2026', [TARDE]),
  el('16/09/2026', [TARDE, DESCANSO]),
  el('15/09/2026', [INCOMPLETA]),
];

function unaPersona(registros: readonly RegistroDia[]) {
  const [persona] = agruparFaltasPorPersona(registros, {}, RANGO);
  if (!persona) throw new Error('expected one person');
  return persona;
}

describe('notificaciones de un día', () => {
  it('arma un día por fecha con falta, del más viejo al más nuevo', () => {
    expect(separarPorDia(unaPersona(REGISTROS)).map((d) => d.fecha)).toEqual(['15/09/2026','16/09/2026','17/09/2026']);
  });

  it('deja juntas en un mismo día todas sus clases de falta', () => {
    const del16 = separarPorDia(unaPersona(REGISTROS))[1];
    expect(del16?.persona.faltasPorTipo.tardanza.map((f) => f.fecha)).toEqual(['16/09/2026']);
    expect(del16?.persona.faltasPorTipo.descanso.map((f) => f.fecha)).toEqual(['16/09/2026']);
    expect(del16?.persona.faltasPorTipo.incompleta).toEqual([]);
  });

  it('suma entre todos los días exactamente las faltas de la persona', () => {
    const persona = unaPersona(REGISTROS);
    const dias = separarPorDia(persona);
    expect(dias.reduce((n, d) => n + totalDeFaltas(d.persona.faltasPorTipo), 0)).toBe(totalDeFaltas(persona.faltasPorTipo));
    // And they are the same rows, not look-alikes: the split never re-formats anything.
    expect(dias.flatMap((d) => d.persona.faltasPorTipo.incompleta)).toEqual(persona.faltasPorTipo.incompleta);
    expect(dias.flatMap((d) => d.persona.faltasPorTipo.descanso)).toEqual(persona.faltasPorTipo.descanso);
    expect(dias.flatMap((d) => d.persona.faltasPorTipo.tardanza)).toEqual(persona.faltasPorTipo.tardanza);
  });

  it('conserva la identidad de la persona en cada día, legajo incluido sólo si existe', () => {
    const [primero] = separarPorDia(unaPersona(REGISTROS));
    expect(primero?.persona).toMatchObject({ usuario:'Persona', dni:'20-00000000-0', sector:'Administración', legajo:'1' });
    const [sinLegajo] = separarPorDia(unaPersona([dia({ legajo:'', faltas:[TARDE] })]));
    expect(sinLegajo?.persona).not.toHaveProperty('legajo');
  });

  it('manda al final los días sin fecha legible, cada uno por su lado', () => {
    // The period filter drops undated registros, so the rows are made undated after grouping:
    // the split has to cope with whatever NotificacionPersona it is handed.
    const base = unaPersona([el('16/09/2026', [TARDE, DESCANSO]), el('17/09/2026', [TARDE])]);
    const [t16, t17] = base.faltasPorTipo.tardanza;
    const [d16] = base.faltasPorTipo.descanso;
    if (!t16 || !t17 || !d16) throw new Error('expected the fixture rows');
    const dias = separarPorDia({ ...base, faltasPorTipo: {
      incompleta: [],
      descanso: [{ ...d16, fecha:'sin dato A', fechaOrden:null }],
      tardanza: [t16, { ...t17, fecha:'sin dato B', fechaOrden:null }],
    } });
    expect(dias.map((d) => d.fecha)).toEqual(['16/09/2026','sin dato A','sin dato B']);
  });

  it('no arma ningún día para quien no tiene faltas', () => {
    const [limpia] = agruparFaltasPorPersona([dia()], {}, RANGO, { incluirSinFaltas:true });
    if (!limpia) throw new Error('expected the clean person');
    expect(separarPorDia(limpia)).toEqual([]);
  });
});

describe('claves de lo que cubre una notificación', () => {
  it('lista (dni, fecha ISO, tipo) por día y en el orden de las faltas', () => {
    expect(clavesNotificadas(unaPersona(REGISTROS))).toEqual([
      { dni:'20-00000000-0', fechaIso:'2026-09-15', tipo:'incompleta' },
      { dni:'20-00000000-0', fechaIso:'2026-09-16', tipo:'descanso' },
      { dni:'20-00000000-0', fechaIso:'2026-09-16', tipo:'tardanza' },
      { dni:'20-00000000-0', fechaIso:'2026-09-17', tipo:'tardanza' },
    ]);
  });

  it('cubre sólo el día cuando recibe la notificación de un día', () => {
    const del16 = separarPorDia(unaPersona(REGISTROS))[1];
    if (!del16) throw new Error('expected the 16th');
    expect(clavesNotificadas(del16.persona).map((c) => `${c.fechaIso}/${c.tipo}`)).toEqual(['2026-09-16/descanso','2026-09-16/tardanza']);
  });

  it('no repite una clave cuando el mismo día trae dos filas de la misma clase', () => {
    const persona = unaPersona([el('16/09/2026', [TARDE]), el('16/09/2026', [TARDE])]);
    expect(totalDeFaltas(persona.faltasPorTipo)).toBe(2);
    expect(clavesNotificadas(persona)).toEqual([{ dni:'20-00000000-0', fechaIso:'2026-09-16', tipo:'tardanza' }]);
  });

  it('saltea las filas sin fecha legible: no se pueden guardar ni comparar', () => {
    const base = unaPersona([el('16/09/2026', [TARDE]), el('17/09/2026', [TARDE])]);
    const [t16, t17] = base.faltasPorTipo.tardanza;
    if (!t16 || !t17) throw new Error('expected the fixture rows');
    const conIlegible = { ...base, faltasPorTipo: { ...base.faltasPorTipo, tardanza: [t16, { ...t17, fecha:'sin dato', fechaOrden:null }] } };
    expect(clavesNotificadas(conIlegible)).toEqual([{ dni:'20-00000000-0', fechaIso:'2026-09-16', tipo:'tardanza' }]);
    expect(idDeFalta(base.dni, { ...t17, fechaOrden:null }, 'tardanza')).toBeNull();
  });

  it('la fecha ISO es el mismo día de la celda QUICKPASS', () => {
    // `fechaOrden` is UTC midnight and `fmtFechaISO` reads it in UTC; a local-time formatter
    // would read it as the 13th anywhere west of Greenwich.
    const [clave] = clavesNotificadas(unaPersona([el('14/09/2026', [TARDE])]));
    expect(clave?.fechaIso).toBe('2026-09-14');
    expect(idFaltaNotificada('1', '2026-09-14', 'tardanza')).toBe('1|2026-09-14|tardanza');
  });
});

describe('cuántas faltas ya están notificadas', () => {
  it('cuenta filas, en la misma escala que el total de faltas', () => {
    const persona = unaPersona(REGISTROS);
    const notificadas = new Set([idFaltaNotificada(persona.dni, '2026-09-16', 'tardanza'), idFaltaNotificada(persona.dni, '2026-09-16', 'descanso')]);
    expect(contarNotificadas(persona, notificadas)).toEqual({ notificadas:2, total:4 });
  });

  it('ignora una clave notificada que ya no es una falta y una de otra persona', () => {
    const persona = unaPersona(REGISTROS);
    const notificadas = new Set([
      idFaltaNotificada(persona.dni, '2026-09-18', 'tardanza'),
      idFaltaNotificada('otra', '2026-09-15', 'incompleta'),
      idFaltaNotificada(persona.dni, '2026-09-15', 'descanso'),
    ]);
    expect(contarNotificadas(persona, notificadas)).toEqual({ notificadas:0, total:4 });
  });
});
