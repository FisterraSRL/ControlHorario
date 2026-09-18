import { describe, expect, it } from 'vitest';

import { sqlAdjuntoPorId, sqlListarAdjuntos } from './repositorioAdjuntos.js';

describe('listado de adjuntos', () => {
  it('sin restricción devuelve todos, en el orden de siempre', () => {
    const consulta = sqlListarAdjuntos(null);
    expect(consulta.texto).toContain('FROM [controlhorario].[adjuntos] a');
    expect(consulta.texto).not.toContain('OPENJSON');
    expect(consulta.texto).toContain('ORDER BY a.[dni], a.[fecha], a.[subido_at], a.[id]');
    expect(consulta.valores).toEqual([]);
  });

  it('con alcance sólo devuelve los días de esos sectores', () => {
    const consulta = sqlListarAdjuntos(['Cocina']);
    expect(consulta.texto).toContain('EXISTS (SELECT 1 FROM [controlhorario].[fichadas] f');
    expect(consulta.texto).toContain('f.[dni] = a.[dni] AND f.[fecha] = a.[fecha]');
    expect(consulta.texto).toContain("JSON_VALUE(f.[payload], '$.Sector')");
    expect(consulta.valores).toEqual(['["Cocina"]']);
  });

  it('un alcance vacío no devuelve la lista completa', () => {
    expect(sqlListarAdjuntos([]).texto).toContain('OPENJSON($1)');
    expect(sqlListarAdjuntos([]).valores).toEqual(['[]']);
  });
});

describe('un adjunto por id', () => {
  it('sin restricción busca sólo por id', () => {
    const consulta = sqlAdjuntoPorId(42, null);
    expect(consulta.texto).toContain('WHERE a.[id] = $1');
    expect(consulta.texto).toContain('a.[blob_path]');
    expect(consulta.valores).toEqual([42]);
  });

  it('con alcance exige además que el día sea de un sector propio', () => {
    // No rows rather than a 403: the callers report "no existe ese adjunto" either way, so a
    // supervisor cannot count the certificates of the sectors they cannot see.
    const consulta = sqlAdjuntoPorId(42, ['Cocina', 'Reparto']);
    expect(consulta.texto).toContain('WHERE a.[id] = $1 AND EXISTS');
    expect(consulta.texto).toContain('OPENJSON($2)');
    expect(consulta.valores).toEqual([42, '["Cocina","Reparto"]']);
  });

  it('el blob_path sigue viniendo en la consulta con alcance', () => {
    // `abrir` and `eliminar` need it to reach the file on disk; a scoped query that dropped
    // it would turn every scoped download into a 404 for a file that is there.
    expect(sqlAdjuntoPorId(42, ['Cocina']).texto).toContain('a.[blob_path]');
  });
});
