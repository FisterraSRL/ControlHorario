import { describe, expect, it } from 'vitest';

import { crearPoolFalso } from './pruebas/dobles.js';
import {
  auditoriaDeNotificacion,
  crearRepositorioNotificaciones,
  sqlNotificadasEnVentana,
  sqlRegistrarNotificadas,
  type FaltaPedida,
} from './repositorioNotificaciones.js';

const FALTAS: readonly FaltaPedida[] = [
  { dni: '11000001', fechaIso: '2026-09-15', tipo: 'tardanza' },
  { dni: '11000001', fechaIso: '2026-09-15', tipo: 'incompleta' },
  { dni: '11000002', fechaIso: '2026-09-16', tipo: 'descanso' },
];

describe('registro de faltas notificadas en SQL', () => {
  it('inserta sólo las claves que faltan, en una sentencia y con un parámetro JSON', () => {
    const { texto, valores } = sqlRegistrarNotificadas(FALTAS, 'rrhh@ejemplo.test');
    expect(texto).toContain('MERGE [controlhorario].[faltas_notificadas] WITH (HOLDLOCK)');
    expect(texto).toContain('OPENJSON($1)');
    expect(texto).toContain('WHEN NOT MATCHED THEN INSERT');
    // Insert only: an existing key keeps its first notificado_at / notificado_por.
    expect(texto).not.toMatch(/WHEN MATCHED/);
    expect(texto).not.toMatch(/\bUPDATE\b/);
    expect(valores).toEqual([
      JSON.stringify([
        { dni: '11000001', fechaIso: '2026-09-15', tipo: 'tardanza' },
        { dni: '11000001', fechaIso: '2026-09-15', tipo: 'incompleta' },
        { dni: '11000002', fechaIso: '2026-09-16', tipo: 'descanso' },
      ]),
      'rrhh@ejemplo.test',
    ]);
  });

  it('lee una ventana de días con los dos extremos incluidos', () => {
    const { texto, valores } = sqlNotificadasEnVentana('2026-09-01', '2026-09-30');
    expect(texto).toContain('FROM [controlhorario].[faltas_notificadas]');
    expect(texto).toContain('>= CONVERT(date, $1)');
    expect(texto).toContain('<= CONVERT(date, $2)');
    expect(valores).toEqual(['2026-09-01', '2026-09-30']);
  });
});

describe('auditoría de una notificación', () => {
  it('escribe una fila por día, con las clases que cubrió y cuáles eran nuevas', () => {
    const filas = auditoriaDeNotificacion(
      FALTAS,
      [{ dni: '11000001', fechaIso: '2026-09-15', tipo: 'tardanza' }],
      'rrhh@ejemplo.test',
    );
    expect(filas).toEqual([
      {
        actor: 'rrhh@ejemplo.test',
        accion: 'faltas_notificadas',
        entidad: 'faltas_notificadas',
        entidadId: '11000001|2026-09-15',
        // Engine order, whatever order the request listed them in.
        datos: { tipos: ['incompleta', 'tardanza'], nuevas: ['tardanza'] },
      },
      {
        actor: 'rrhh@ejemplo.test',
        accion: 'faltas_notificadas',
        entidad: 'faltas_notificadas',
        entidadId: '11000002|2026-09-16',
        datos: { tipos: ['descanso'], nuevas: [] },
      },
    ]);
  });
});

describe('repositorio de notificaciones', () => {
  it('inserta y audita en una sola transacción y devuelve cuántas claves eran nuevas', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE')
        ? { rows: [{ dni: '11000002', fecha: '2026-09-16', tipo: 'descanso' }] }
        : undefined,
    );
    const registradas = await crearRepositorioNotificaciones(pool).registrar(FALTAS, 'rrhh@ejemplo.test');

    expect(registradas).toBe(1);
    expect(pool.llamadas).toHaveLength(2);
    expect(pool.llamadas.every((l) => l.enTransaccion)).toBe(true);
    expect(pool.llamadas[1]?.texto).toContain('INSERT INTO [controlhorario].[auditoria]');
    const auditadas = JSON.parse(String(pool.llamadas[1]?.valores[0])) as { entidadId: string; datos: string }[];
    expect(auditadas.map((a) => [a.entidadId, JSON.parse(a.datos) as unknown])).toEqual([
      ['11000001|2026-09-15', { tipos: ['incompleta', 'tardanza'], nuevas: [] }],
      ['11000002|2026-09-16', { tipos: ['descanso'], nuevas: ['descanso'] }],
    ]);
    expect(pool.cierres).toEqual(['commit']);
  });

  it('una clave foránea rota deshace todo, sin auditar', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? Object.assign(new Error('FK'), { number: 547 }) : undefined,
    );
    await expect(
      crearRepositorioNotificaciones(pool).registrar(FALTAS, 'rrhh@ejemplo.test'),
    ).rejects.toMatchObject({ number: 547 });
    expect(pool.llamadas).toHaveLength(1);
    expect(pool.cierres).toEqual(['rollback']);
  });

  it('devuelve la marca de tiempo como ISO', async () => {
    const pool = crearPoolFalso(() => ({
      rows: [
        {
          dni: '11000001',
          fecha: '2026-09-15',
          tipo: 'tardanza',
          notificado_at: new Date('2026-09-20T13:00:00.000Z'),
        },
      ],
    }));
    expect(await crearRepositorioNotificaciones(pool).listar('2026-09-01', '2026-09-30')).toEqual([
      { dni: '11000001', fecha: '2026-09-15', tipo: 'tardanza', notificadoAt: '2026-09-20T13:00:00.000Z' },
    ]);
  });
});
