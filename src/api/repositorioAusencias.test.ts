import { describe, expect, it } from 'vitest';

import { crearPoolFalso } from './pruebas/dobles.js';
import {
  crearRepositorioAusencias,
  sqlAsignarMotivos,
  sqlRegistroAusencias,
} from './repositorioAusencias.js';

const FILA_REGISTRO = {
  dni: '11000001',
  fecha: '2026-01-05',
  motivo_id: 4,
  motivo_source: 'encargado',
  resuelto_por: 'jefa@ejemplo.test',
  resuelto_at: '2026-01-06T10:00:00.000Z',
  adjuntos: 0,
};

describe('consulta del registro de ausencias', () => {
  it('sin restricción lee el registro entero', () => {
    const consulta = sqlRegistroAusencias(null);
    expect(consulta.texto).toContain('FROM [controlhorario].[ausencias] a');
    // No join to `fichadas` and no scope parameter: this is the query that ran before the
    // role existed. (The only WHERE left is the one counting attachments per day.)
    expect(consulta.texto).not.toContain('[controlhorario].[fichadas]');
    expect(consulta.texto).not.toContain('OPENJSON');
    expect(consulta.texto).toContain('ORDER BY a.[dni], a.[fecha]');
    expect(consulta.valores).toEqual([]);
  });

  it('con alcance llega al sector a través de fichadas', () => {
    // `ausencias` has no sector column and must not get one: the sector is a QUICKPASS cell
    // and a copy of it here would go stale on the next upload.
    const consulta = sqlRegistroAusencias(['Cocina']);
    expect(consulta.texto).toContain(
      'JOIN [controlhorario].[fichadas] f ON f.[dni] = a.[dni] AND f.[fecha] = a.[fecha]',
    );
    expect(consulta.texto).toContain("WHERE JSON_VALUE(f.[payload], '$.Sector')");
    expect(consulta.texto).toContain('OPENJSON($1)');
    expect(consulta.valores).toEqual(['["Cocina"]']);
  });

  it('un alcance vacío no devuelve el registro completo', () => {
    expect(sqlRegistroAusencias([]).texto).toContain('OPENJSON($1)');
    expect(sqlRegistroAusencias([]).valores).toEqual(['[]']);
  });

  it('el conteo de adjuntos sigue siendo por día', () => {
    expect(sqlRegistroAusencias(['Cocina']).texto).toContain('[controlhorario].[adjuntos] ad');
  });
});

describe('atribución de una decisión sobre un día', () => {
  it('la decisión de un encargado se guarda como tal', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? { rows: [FILA_REGISTRO] } : undefined,
    );
    const repositorio = crearRepositorioAusencias(pool);

    const ausencia = await repositorio.asignarMotivo(
      '11000001',
      '2026-01-05',
      4,
      'jefa@ejemplo.test',
      'encargado',
    );

    const merge = pool.llamadas.find((l) => l.texto.includes('MERGE'));
    expect(merge?.valores).toEqual(['11000001', '2026-01-05', 4, 'jefa@ejemplo.test', 'encargado']);
    // Parameterised, not two copies of the statement with a different literal in each.
    expect(merge?.texto).not.toContain("N'manual'");
    expect(merge?.texto).toContain('CASE WHEN origen.[motivo_id] IS NULL THEN NULL ELSE $5 END');
    expect(ausencia?.motivoSource).toBe('encargado');
  });

  it('la de RRHH sigue siendo manual', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? { rows: [{ ...FILA_REGISTRO, motivo_source: 'manual' }] } : undefined,
    );
    const repositorio = crearRepositorioAusencias(pool);

    await repositorio.asignarMotivo('11000001', '2026-01-05', 4, 'rrhh@ejemplo.test', 'manual');

    expect(pool.llamadas.find((l) => l.texto.includes('MERGE'))?.valores[4]).toBe('manual');
  });

  it('firma la decisión de un encargado igual que la de RRHH', async () => {
    // `CK_ch_ausencias_manual_atribuible` only demands attribution for 'manual'. A decision
    // nobody signed is not better because a CHECK tolerates it.
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? { rows: [FILA_REGISTRO] } : undefined,
    );
    const repositorio = crearRepositorioAusencias(pool);

    const ausencia = await repositorio.asignarMotivo(
      '11000001',
      '2026-01-05',
      4,
      'jefa@ejemplo.test',
      'encargado',
    );

    const merge = pool.llamadas.find((l) => l.texto.includes('MERGE'));
    expect(merge?.texto).toContain('[resuelto_por] = origen.[actor]');
    expect(merge?.texto).toContain('[resuelto_at] = SYSUTCDATETIME()');
    expect(ausencia?.resueltoPor).toBe('jefa@ejemplo.test');
  });

  it('el origen queda en la auditoría para poder distinguirlo', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? { rows: [FILA_REGISTRO] } : undefined,
    );
    const repositorio = crearRepositorioAusencias(pool);

    await repositorio.asignarMotivo('11000001', '2026-01-05', 4, 'jefa@ejemplo.test', 'encargado');

    const auditoria = pool.llamadas.find((l) => l.texto.includes('[controlhorario].[auditoria]'));
    expect(auditoria?.valores[1]).toBe('motivo_asignado');
    expect(auditoria?.valores[4]).toBe(
      JSON.stringify({ motivoId: 4, motivoAnterior: null, origen: 'encargado' }),
    );
  });
});

describe('clasificación de varios días en una sola decisión', () => {
  const DIAS = [
    { dni: '11000001', fechaIso: '2026-01-05' },
    { dni: '11000002', fechaIso: '2026-01-06' },
  ];

  /** What the batch statement hands back: the rows written, with the motivo before. */
  const filasEscritas = (motivoId: number | null, anteriores: (number | null)[]) =>
    DIAS.map((d, i) => ({
      ...FILA_REGISTRO,
      dni: d.dni,
      dni_pedido: d.dni,
      fecha: d.fechaIso,
      motivo_id: motivoId,
      motivo_source: motivoId === null ? null : 'encargado',
      motivo_anterior: anteriores[i] ?? null,
    }));

  it('los días viajan en un único parámetro JSON y conservan las reglas del MERGE de un día', () => {
    const consulta = sqlAsignarMotivos(DIAS, 4, 'jefa@ejemplo.test', 'encargado');

    expect(consulta.valores).toEqual([
      JSON.stringify(DIAS),
      4,
      'jefa@ejemplo.test',
      'encargado',
    ]);
    expect(consulta.texto).toContain('OPENJSON($1)');
    expect(consulta.texto).toContain('MERGE [controlhorario].[ausencias] WITH (HOLDLOCK)');
    // The same clauses as the single-day statement: source cleared with the motivo, and the
    // decision signed on both branches.
    expect(consulta.texto).toContain('CASE WHEN origen.[motivo_id] IS NULL THEN NULL ELSE $4 END');
    expect(consulta.texto).toContain('[resuelto_por] = origen.[actor]');
    expect(consulta.texto).toContain('[resuelto_at] = SYSUTCDATETIME()');
    // The motivo before the write, read atomically with it, for the audit.
    expect(consulta.texto).toContain('deleted.[motivo_id]');
    // Parameterised, not one statement per role.
    expect(consulta.texto).not.toContain("N'manual'");
    expect(consulta.texto).not.toContain("N'encargado'");
  });

  it('escribe y audita dentro de una sola transacción', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? { rows: filasEscritas(4, [null, 2]) } : undefined,
    );
    const repositorio = crearRepositorioAusencias(pool);

    const ausencias = await repositorio.asignarMotivos(DIAS, 4, 'jefa@ejemplo.test', 'encargado');

    expect(pool.llamadas).toHaveLength(2);
    expect(pool.llamadas.every((l) => l.enTransaccion)).toBe(true);
    expect(pool.cierres).toEqual(['commit']);
    expect(ausencias.map((a) => [a.dni, a.fecha, a.motivoId])).toEqual([
      ['11000001', '2026-01-05', 4],
      ['11000002', '2026-01-06', 4],
    ]);
  });

  it('deja una fila de auditoría por día, idéntica a la que deja la ruta de un día', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? { rows: filasEscritas(4, [null, 2]) } : undefined,
    );
    await crearRepositorioAusencias(pool).asignarMotivos(
      DIAS,
      4,
      'jefa@ejemplo.test',
      'encargado',
    );
    const auditoria = pool.llamadas.find((l) => l.texto.includes('[controlhorario].[auditoria]'));
    const filas = JSON.parse(String(auditoria?.valores[0])) as Record<string, unknown>[];

    // The row the single path writes for the first day, recorded the same way.
    const unoSolo = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? { rows: [FILA_REGISTRO] } : undefined,
    );
    await crearRepositorioAusencias(unoSolo).asignarMotivo(
      '11000001',
      '2026-01-05',
      4,
      'jefa@ejemplo.test',
      'encargado',
    );
    const individual = unoSolo.llamadas.find((l) =>
      l.texto.includes('[controlhorario].[auditoria]'),
    );

    expect(filas).toHaveLength(2);
    expect(Object.values(filas[0] ?? {})).toEqual(individual?.valores);
    expect(filas[1]).toEqual({
      actor: 'jefa@ejemplo.test',
      accion: 'motivo_asignado',
      entidad: 'ausencias',
      entidadId: '11000002|2026-01-06',
      datos: JSON.stringify({ motivoId: 4, motivoAnterior: 2, origen: 'encargado' }),
    });
  });

  it('quitar la clasificación en lote se audita como motivo_quitado', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? { rows: filasEscritas(null, [4, 4]) } : undefined,
    );
    await crearRepositorioAusencias(pool).asignarMotivos(DIAS, null, 'rrhh@ejemplo.test', 'manual');

    const auditoria = pool.llamadas.find((l) => l.texto.includes('[controlhorario].[auditoria]'));
    const filas = JSON.parse(String(auditoria?.valores[0])) as { accion: string }[];
    expect(filas.map((f) => f.accion)).toEqual(['motivo_quitado', 'motivo_quitado']);
  });

  it('si el MERGE falla no audita nada y deshace la transacción', async () => {
    // An unknown motivo or a day with no fichada is an FK violation inside the statement.
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? Object.assign(new Error('FK'), { number: 547 }) : undefined,
    );

    await expect(
      crearRepositorioAusencias(pool).asignarMotivos(DIAS, 99, 'rrhh@ejemplo.test', 'manual'),
    ).rejects.toThrow('FK');
    expect(pool.textos().some((t) => t.includes('[controlhorario].[auditoria]'))).toBe(false);
    expect(pool.cierres).toEqual(['rollback']);
  });

  it('un lote vacío no abre transacción', async () => {
    const pool = crearPoolFalso();
    await expect(
      crearRepositorioAusencias(pool).asignarMotivos([], 4, 'rrhh@ejemplo.test', 'manual'),
    ).resolves.toEqual([]);
    expect(pool.llamadas).toHaveLength(0);
  });
});
