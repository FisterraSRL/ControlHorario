import { read, utils } from 'xlsx';
import { describe, expect, it } from 'vitest';
import { prepararExcelAusencias, generarExcelAusencias } from './excelAusencias.js';
import { crearRepositorioLocal } from '../../historial/repositorioLocal.js';
import { crearRepositorioAusenciasLocal } from '../../ausencias/repositorioAusenciasLocal.js';
import { leerPlanilla } from '../carga/planilla.js';
import type { AusenciaRegistrada } from '../../ausencias/RepositorioAusencias.js';

const rango = { desde: new Date('2026-10-12T00:00:00Z'), hasta: new Date('2026-10-18T00:00:00Z') };
const decision = (dni: string, motivoId: number | null, motivoLabel?: string): AusenciaRegistrada => ({
  dni, fecha: '2026-10-12', motivoId, motivoSource: motivoId === null ? null : 'manual',
  resueltoPor: null, resueltoAt: null, adjuntos: 0, ...(motivoLabel === undefined ? {} : { motivoLabel }),
});
const filas = [
  { Sector: 'Prueba', Usuario: 'Persona ficticia', DNI: '0001', Legajo: '00002', Fecha: '12/10/2026', Movimientos: '', Partes: 'nota original', Extra: '=1+1' },
  { Sector: 'Otro', Usuario: 'Presencia ficticia', DNI: '0002', Fecha: '13/10/2026', Movimientos: '08:00 - 17:00', Partes: 'No cambiar', Otra: '09:05' },
  { DNI: '0003', Fecha: '18/10/2026', Turno: 'F: 0hs', Partes: 'Franco' },
  { DNI: '0004', Fecha: '11/10/2026', Partes: 'Fuera' },
];
const motivos = [{ id: 4, label: 'Vacaciones', worked: true }];

describe('QUICKPASS Excel with saved absence reasons', () => {
  it('exports the whole inclusive period with original columns and only saved reasons replaced', () => {
    const original = JSON.stringify(filas);
    const datos = prepararExcelAusencias(filas, [decision('0001', 4)], motivos, rango);
    expect(datos.filas).toHaveLength(3);
    expect(datos.filas[0]?.Partes).toBe('Vacaciones');
    expect(datos.filas[1]).toEqual(filas[1]);
    expect(datos.filas[2]).toEqual(filas[2]);
    expect(datos.columnas).toEqual(['Sector', 'Usuario', 'DNI', 'Legajo', 'Fecha', 'Movimientos', 'Partes', 'Extra', 'Otra', 'Turno']);
    expect(JSON.stringify(filas)).toBe(original);
  });
  it('preserves the evidence note for null or absent decisions and ignores unresolved ids outside the period', () => {
    const datos = prepararExcelAusencias(filas, [decision('0001', null), { ...decision('0004', 99), fecha: '2026-10-11' }], [], rango);
    expect(datos.filas[0]?.Partes).toBe('nota original');
  });
  it('keeps original PARTES header case and adds Partes only when entirely absent', () => {
    const datos = prepararExcelAusencias([{ DNI: '0001', Fecha: '12/10/2026', PARTES: 'Vieja' }], [decision('0001', 4)], motivos, rango);
    expect(datos.columnas).toEqual(['DNI', 'Fecha', 'PARTES']);
    expect(datos.filas[0]?.PARTES).toBe('Vacaciones');
    expect(prepararExcelAusencias([{ DNI: '0001', Fecha: '12/10/2026' }], [decision('0001', 4)], motivos, rango).filas[0]?.Partes).toBe('Vacaciones');
  });
  it('exports retired labels from the registry and prefers the current label when still active', () => {
    expect(prepararExcelAusencias(filas, [decision('0001', 99, 'Motivo retirado')], motivos, rango).filas[0]?.Partes).toBe('Motivo retirado');
    expect(prepararExcelAusencias(filas, [decision('0001', 4, 'Anterior')], motivos, rango).filas[0]?.Partes).toBe('Vacaciones');
  });
  it('refuses partial files when any saved reason is unknown or blank', () => {
    expect(() => prepararExcelAusencias(filas, [decision('0001', 99)], motivos, rango)).toThrow('motivo');
    expect(() => prepararExcelAusencias(filas, [decision('0001', 99, '  ')], motivos, rango)).toThrow('motivo');
  });
  it('preserves full original notes for automatic Partes classifications, even without a label', () => {
    const datos = prepararExcelAusencias(filas, [{ ...decision('0001', 99), motivoSource: 'partes' }], [], rango);
    expect(datos.filas[0]?.Partes).toBe('nota original');
  });
  it('refuses an empty period instead of downloading a misleading empty workbook', () => {
    expect(() => prepararExcelAusencias([], [], motivos, rango)).toThrow('período');
  });
  it('writes a real XLSX with text dates, leading-zero identities, extra columns and literal formula-looking notes', async () => {
    const archivo = await generarExcelAusencias(prepararExcelAusencias(filas, [decision('0001', 4)], motivos, rango), rango);
    expect(archivo.nombre).toBe('quickpass_con_motivos_2026-10-12_2026-10-18.xlsx');
    expect([...archivo.bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    const libro = read(archivo.bytes, { type: 'array' });
    expect(libro.SheetNames).toEqual(['QUICKPASS']);
    const hoja = libro.Sheets.QUICKPASS!;
    expect(utils.sheet_to_json(hoja, { defval: '' })).toMatchObject([{ DNI: '0001', Legajo: '00002', Fecha: '12/10/2026', Partes: 'Vacaciones', Extra: '=1+1' }, { DNI: '0002', Partes: 'No cambiar' }, { DNI: '0003', Partes: 'Franco' }]);
    expect(hoja.H2).toMatchObject({ t: 's', v: '=1+1' });
    expect(hoja.H2.f).toBeUndefined();
  });
  it('round-trips an imported workbook through a saved classification without rewriting original evidence', async () => {
    const historial = crearRepositorioLocal(null);
    const imported = await generarExcelAusencias({ columnas: Object.keys(filas[0]!), filas: [filas[0]!] }, rango);
    const planilla = await leerPlanilla(new File([imported.bytes], 'entrada.xlsx'));
    await historial.upsert(planilla.filas);
    const repo = crearRepositorioAusenciasLocal(historial, null, async () => motivos);
    await repo.asignarMotivo('0001', '12/10/2026', 4);
    const originales = await historial.listar();
    const archivo = await generarExcelAusencias(prepararExcelAusencias(originales, await repo.listar(), motivos, rango), rango);
    const salida = await leerPlanilla(new File([archivo.bytes], archivo.nombre));
    expect(salida.filas[0]).toEqual({ ...planilla.filas[0], Partes: 'Vacaciones' });
    expect(await historial.listar()).toEqual(planilla.filas);
  });

});
