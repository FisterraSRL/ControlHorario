import { describe, expect, it } from 'vitest';
import type { RegistroDia, SemanaEmpleado } from '../../../domain/fichadas/index.js';
import { crearPeriodo, crearRango } from '../../periodo/periodo.js';
import { abiertasVisibles, alternarSemana, avisoSemanasParciales, claveSemana, construirReporteHoras, csvDeHoras, desplegarTodas, lineaFichadas, rangoSemana, todasAbiertas } from './horas.js';

function dia(fecha: Date, horasBrutas = 480): RegistroDia {
  return { sector:'Administración', usuario:'Persona', dni:'20-00000000-0', legajo:'1', fecha, fechaStr:'14/09/2026', inicioSemana:'2026-09-14', cantidadMovimientos:2, movimientos:[480,960], turnoRaw:'08:00 - 16:00', esDiaLibre:false, esFlexible:false, inicioTurno:480, fichadasRequeridas:2, horasTurno:480, horasBrutas, cantidadTarde:0, partesRaw:'', descansoReal:0, faltas:[], tipoDia:'trabajo', motivoId:null, motivoSource:null, excluido:false };
}

describe('vista de horas trabajadas', () => {
  it('usa sólo los días dentro del período', () => {
    const reporte = construirReporteHoras([dia(new Date('2026-09-14T00:00:00Z')), dia(new Date('2026-09-21T00:00:00Z'),60)], {horasTurnoSemanales:8}, {desde:new Date('2026-09-14T00:00:00Z'),hasta:new Date('2026-09-20T00:00:00Z')});
    expect(reporte).toHaveLength(1); expect(reporte[0]?.horasTrabajadas).toBe(480);
  });
  it('muestra la semana de lunes a domingo', () => { expect(rangoSemana('2026-09-14')).toBe('14/09/2026 – 20/09/2026'); });
  it('exporta un CSV compatible con Excel en español', () => {
    const [semana] = construirReporteHoras([dia(new Date('2026-09-14T00:00:00Z'))], {horasTurnoSemanales:8}, {desde:new Date('2026-09-14T00:00:00Z'),hasta:new Date('2026-09-20T00:00:00Z')});
    const csv = csvDeHoras(semana ? [semana] : []); expect(csv.startsWith('\ufeffSector;Persona;DNI')).toBe(true); expect(csv).toContain('Administración;Persona;20-00000000-0;1;14/09/2026;20/09/2026;8:00;8:00;0:00;+0:00;0');
  });
});

function semana(dni: string, inicioSemana = '2026-09-14'): SemanaEmpleado {
  return { dni, usuario:'Persona', legajo:'1', sector:'Administración', inicioSemana, horasTurno:0, horasTrabajadas:0, horasDescanso:0, horasJustificadas:0, diferencia:0, diasAusenciaSinClasificar:0, dias:[] };
}

describe('desplegar y contraer las semanas', () => {
  const visibles = [semana('A'), semana('B')];
  it('ignora las claves de semanas que ya no están en pantalla', () => {
    const abiertas = new Set([claveSemana(semana('A')), claveSemana(semana('A', '2026-08-31'))]);
    expect([...abiertasVisibles(abiertas, visibles)]).toEqual(['A|2026-09-14']);
  });
  it('sólo cuenta como todas abiertas cuando cada semana visible lo está', () => {
    expect(todasAbiertas(new Set(['A|2026-09-14']), visibles)).toBe(false);
    expect(todasAbiertas(new Set(['A|2026-09-14', 'B|2026-09-14']), visibles)).toBe(true);
  });
  it('no muestra «Contraer todas» con la tabla vacía', () => { expect(todasAbiertas(new Set(), [])).toBe(false); });
  it('desplegar todas abre exactamente las visibles y contraer las cierra todas', () => {
    expect([...desplegarTodas(visibles, true)]).toEqual(['A|2026-09-14', 'B|2026-09-14']);
    expect(desplegarTodas(visibles, false).size).toBe(0);
  });
  it('alterna una semana sin tocar el conjunto previo', () => {
    const previo = new Set(['A|2026-09-14']);
    expect([...alternarSemana(previo, 'B|2026-09-14')]).toEqual(['A|2026-09-14', 'B|2026-09-14']);
    expect(alternarSemana(previo, 'A|2026-09-14').size).toBe(0);
    expect(previo.size).toBe(1);
  });
});

describe('fichadas del día en el detalle', () => {
  const base = dia(new Date('2026-09-14T00:00:00Z'));
  it('lista las fichadas en hora de reloj con las horas trabajadas', () => {
    expect(lineaFichadas({ ...base, movimientos:[480,725,765,1000], horasBrutas:480 })).toBe('08:00 · 12:05 · 12:45 · 16:40 · 8:00 trabajadas');
  });
  it('en una ausencia dice que no hubo fichadas y muestra la nota de QUICKPASS', () => {
    const ausencia: RegistroDia = { ...base, movimientos:[], cantidadMovimientos:0, tipoDia:'ausencia' };
    expect(lineaFichadas(ausencia)).toBe('Sin fichadas');
    expect(lineaFichadas({ ...ausencia, partesRaw:' Licencia médica ' })).toBe('Sin fichadas · Nota QUICKPASS: Licencia médica');
  });
  it('un franco sin fichadas no tiene línea, uno con fichadas sí', () => {
    const franco: RegistroDia = { ...base, movimientos:[], tipoDia:'libre', esDiaLibre:true };
    expect(lineaFichadas(franco)).toBeNull();
    expect(lineaFichadas({ ...franco, movimientos:[600], horasBrutas:0 })).toBe('10:00 · 0:00 trabajadas');
  });
});

describe('aviso de semanas incompletas en el período', () => {
  // September 2026: the 1st is a Tuesday, the 14th a Monday, the 20th and 27th Sundays.
  const d = (n: number) => new Date(Date.UTC(2026, 8, n));

  it('no avisa con una semana ni con un rango de lunes a domingo', () => {
    expect(avisoSemanasParciales(crearPeriodo('semana', d(17)))).toBeNull();
    expect(avisoSemanasParciales(crearRango(d(14), d(27)))).toBeNull();
  });

  it('nombra la semana que queda corta y por qué la diferencia engaña', () => {
    expect(avisoSemanasParciales(crearRango(d(16), d(27)))).toMatch(/^La primera semana del período está incompleta: .*turno semanal completo/);
    expect(avisoSemanasParciales(crearRango(d(14), d(24)))).toMatch(/^La última semana del período está incompleta/);
    expect(avisoSemanasParciales(crearRango(d(16), d(24)))).toMatch(/^La primera y la última semana del período están incompletas/);
  });

  it('avisa también con el botón Mes, que corta semanas igual que un rango', () => {
    expect(avisoSemanasParciales(crearPeriodo('mes', d(17)))).toMatch(/^La primera y la última semana del período están incompletas/);
  });

  it('un período dentro de una sola semana no habla de dos semanas', () => {
    expect(avisoSemanasParciales(crearRango(d(15), d(17)))).toMatch(/^El período no cubre la semana entera/);
    expect(avisoSemanasParciales(crearPeriodo('dia', d(17)))).toMatch(/^El período no cubre la semana entera/);
  });
});
