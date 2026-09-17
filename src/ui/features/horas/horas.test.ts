import { describe, expect, it } from 'vitest';
import type { RegistroDia } from '../../../domain/fichadas/index.js';
import { construirReporteHoras, csvDeHoras, rangoSemana } from './horas.js';

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
