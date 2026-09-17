import { describe, expect, it } from 'vitest';
import type { RegistroDia } from '../../domain/fichadas/index.js';
import { agruparFaltasPorPersona } from './agrupacion.js';

const RANGO = { desde: new Date('2026-09-14T00:00:00Z'), hasta: new Date('2026-09-20T00:00:00Z') };

function dia(campos: Partial<RegistroDia> = {}): RegistroDia {
  return { sector:'Administración', usuario:'Persona', dni:'20-00000000-0', legajo:'1', fecha:new Date('2026-09-14T00:00:00Z'), fechaStr:'14/09/2026', inicioSemana:'2026-09-14', cantidadMovimientos:2, movimientos:[480,960], turnoRaw:'08:00 - 16:00', esDiaLibre:false, esFlexible:false, inicioTurno:480, fichadasRequeridas:2, horasTurno:480, horasBrutas:480, cantidadTarde:0, partesRaw:'', descansoReal:0, faltas:[], tipoDia:'trabajo', motivoId:null, motivoSource:null, excluido:false, ...campos };
}

describe('agrupación de faltas por persona', () => {
  it('deja afuera los días fuera del período', () => {
    const personas = agruparFaltasPorPersona([dia({ fecha:new Date('2026-09-21T00:00:00Z'), faltas:[{tipo:'tardanza',detalle:'Llegó tarde'}] })], {}, RANGO);
    expect(personas).toHaveLength(0);
  });

  it('no crea una persona a partir de un registro sin faltas', () => {
    expect(agruparFaltasPorPersona([dia()], {}, RANGO)).toHaveLength(0);
  });

  it('manda cada clase de falta a su tipo con los campos formateados', () => {
    const [persona] = agruparFaltasPorPersona([dia({ movimientos:[482,1195], cantidadMovimientos:2, fichadasRequeridas:4, descansoReal:75, cantidadTarde:12, faltas:[{tipo:'incompleta',detalle:'Faltan fichadas'},{tipo:'descanso',detalle:'Descanso excedido'},{tipo:'tardanza',detalle:'Llegó tarde'}] })], {}, RANGO);
    expect(persona?.faltasPorTipo.incompleta).toEqual([{fecha:'14/09/2026',turnoRaw:'08:00 - 16:00',fechaOrden:new Date('2026-09-14T00:00:00Z'),detalle:'Faltan fichadas',registradas:'08:02 - 19:55',cantidad:'2 de 4'}]);
    expect(persona?.faltasPorTipo.descanso[0]).toMatchObject({descansoTomado:'1:15',exceso:'0:45'});
    expect(persona?.faltasPorTipo.tardanza[0]).toMatchObject({horarioFichado:'08:02',minutos:'0:12'});
  });

  it('usa el em dash cuando no hay ninguna fichada registrada', () => {
    const [persona] = agruparFaltasPorPersona([dia({ movimientos:[], cantidadMovimientos:0, fichadasRequeridas:4, faltas:[{tipo:'incompleta',detalle:'Sin fichadas'},{tipo:'tardanza',detalle:'Llegó tarde'}] })], {}, RANGO);
    expect(persona?.faltasPorTipo.incompleta[0]?.registradas).toBe('—');
    expect(persona?.faltasPorTipo.tardanza[0]?.horarioFichado).toBe('—');
  });

  it('calcula el exceso de descanso con el máximo de la configuración', () => {
    const registros = [dia({ descansoReal:75, faltas:[{tipo:'descanso',detalle:'Descanso excedido'}] })];
    expect(agruparFaltasPorPersona(registros, {descansoMaxMin:45}, RANGO)[0]?.faltasPorTipo.descanso[0]?.exceso).toBe('0:30');
    expect(agruparFaltasPorPersona(registros, {}, RANGO)[0]?.faltasPorTipo.descanso[0]?.exceso).toBe('0:45');
  });

  it('informa el parte QUICKPASS cuando olvidó fichar con todas las fichadas presentes', () => {
    const [persona] = agruparFaltasPorPersona([dia({ movimientos:[480,720,780,960], cantidadMovimientos:4, fichadasRequeridas:4, faltas:[{tipo:'incompleta',detalle:'Olvidó fichar',olvidoFichar:true}] })], {}, RANGO);
    expect(persona?.faltasPorTipo.incompleta[0]?.cantidad).toBe('Olvidó fichar (parte QUICKPASS)');
  });

  it('cuenta las fichadas cuando el olvido no llega a cubrir las requeridas', () => {
    const [persona] = agruparFaltasPorPersona([dia({ cantidadMovimientos:2, fichadasRequeridas:4, faltas:[{tipo:'incompleta',detalle:'Olvidó fichar',olvidoFichar:true}] })], {}, RANGO);
    expect(persona?.faltasPorTipo.incompleta[0]?.cantidad).toBe('2 de 4');
  });

  it('acumula los días de una misma persona y los ordena por fecha', () => {
    const faltas = [{tipo:'tardanza' as const, detalle:'Llegó tarde'}];
    const personas = agruparFaltasPorPersona([dia({fecha:new Date('2026-09-17T00:00:00Z'),fechaStr:'17/09/2026',faltas}), dia({fecha:new Date('2026-09-15T00:00:00Z'),fechaStr:'15/09/2026',faltas})], {}, RANGO);
    expect(personas).toHaveLength(1);
    expect(personas[0]?.faltasPorTipo.tardanza.map((f) => f.fecha)).toEqual(['15/09/2026','17/09/2026']);
  });

  it('se queda con el último sector no vacío de la persona', () => {
    const faltas = [{tipo:'tardanza' as const, detalle:'Llegó tarde'}];
    const personas = agruparFaltasPorPersona([dia({sector:'Depósito',faltas}), dia({sector:'',faltas}), dia({sector:'Logística',faltas})], {}, RANGO);
    expect(personas[0]?.sector).toBe('Logística');
  });

  it('ordena por sector y después por usuario', () => {
    const faltas = [{tipo:'tardanza' as const, detalle:'Llegó tarde'}];
    const personas = agruparFaltasPorPersona([
      dia({sector:'Depósito',usuario:'Zulema',dni:'1',faltas}),
      dia({sector:'Administración',usuario:'Nadia',dni:'2',faltas}),
      dia({sector:'Depósito',usuario:'Ariel',dni:'3',faltas}),
    ], {}, RANGO);
    expect(personas.map((p) => `${p.sector}/${p.usuario}`)).toEqual(['Administración/Nadia','Depósito/Ariel','Depósito/Zulema']);
  });

  it('omite el legajo cuando la persona no lo tiene', () => {
    const faltas = [{tipo:'tardanza' as const, detalle:'Llegó tarde'}];
    expect(agruparFaltasPorPersona([dia({legajo:'',faltas})], {}, RANGO)[0]).not.toHaveProperty('legajo');
    expect(agruparFaltasPorPersona([dia({legajo:'77',faltas})], {}, RANGO)[0]?.legajo).toBe('77');
  });
});

describe('agrupación con las personas sin faltas incluidas', () => {
  it('suma en cero a quien trabajó el día limpio sólo cuando se pide', () => {
    const registros = [dia()];
    expect(agruparFaltasPorPersona(registros, {}, RANGO)).toHaveLength(0);
    const [persona] = agruparFaltasPorPersona(registros, {}, RANGO, {incluirSinFaltas:true});
    expect(persona?.usuario).toBe('Persona');
    expect(persona?.faltasPorTipo).toEqual({incompleta:[],descanso:[],tardanza:[]});
  });

  it('no arma una fila en cero para una persona excluida', () => {
    expect(agruparFaltasPorPersona([dia({excluido:true})], {}, RANGO, {incluirSinFaltas:true})).toHaveLength(0);
  });

  it('no arma una fila en cero para un día libre', () => {
    expect(agruparFaltasPorPersona([dia({esDiaLibre:true,tipoDia:'libre'})], {}, RANGO, {incluirSinFaltas:true})).toHaveLength(0);
  });

  it('cuenta la falta de un día de ausencia por olvido de fichar, igual que Notificaciones', () => {
    // `dia.ts` marca `tipoDia:'ausencia'` y a la vez emite la falta cuando nadie fichó y el
    // parte QUICKPASS dice "olvidó fichar". El legacy descartaba ese registro entero y las
    // dos pantallas informaban números distintos para la misma persona.
    const registros = [dia({movimientos:[],cantidadMovimientos:0,fichadasRequeridas:4,tipoDia:'ausencia',faltas:[{tipo:'incompleta',detalle:'0 de 4 fichadas',olvidoFichar:true}]})];
    const conLimpias = agruparFaltasPorPersona(registros, {}, RANGO, {incluirSinFaltas:true});
    expect(conLimpias[0]?.faltasPorTipo.incompleta).toHaveLength(1);
    expect(conLimpias[0]?.faltasPorTipo.incompleta).toEqual(agruparFaltasPorPersona(registros, {}, RANGO)[0]?.faltasPorTipo.incompleta);
  });

  it('mezcla en una sola lista a quien tiene faltas y a quien no', () => {
    const personas = agruparFaltasPorPersona([
      dia({usuario:'Ariel',dni:'1'}),
      dia({usuario:'Zulema',dni:'2',faltas:[{tipo:'tardanza',detalle:'Llegó tarde'}]}),
    ], {}, RANGO, {incluirSinFaltas:true});
    expect(personas.map((p) => [p.usuario, p.faltasPorTipo.tardanza.length])).toEqual([['Ariel',0],['Zulema',1]]);
  });
});
