import { describe, expect, it } from 'vitest';

import { crearPoolFalso } from './pruebas/dobles.js';
import { crearRepositorioAusencias, sqlRegistroAusencias } from './repositorioAusencias.js';

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
