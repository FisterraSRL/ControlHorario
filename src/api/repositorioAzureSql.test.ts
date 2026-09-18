import { describe, expect, it } from 'vitest';

import { sqlListarFichadas } from './repositorioAzureSql.js';

const ORDEN = 'ORDER BY [carga_id], [dni], [fecha]';

describe('consulta del historial', () => {
  it('sin restricción lee la tabla entera y conserva el orden', () => {
    const consulta = sqlListarFichadas(null);
    expect(consulta.texto).toContain('FROM [controlhorario].[fichadas]');
    expect(consulta.texto).not.toContain('WHERE');
    expect(consulta.texto).toContain(ORDEN);
    expect(consulta.valores).toEqual([]);
  });

  it('con alcance filtra por el sector del payload', () => {
    const consulta = sqlListarFichadas(['Cocina', 'Reparto']);
    expect(consulta.texto).toContain("WHERE JSON_VALUE([payload], '$.Sector')");
    expect(consulta.texto).toContain('OPENJSON($1)');
    expect(consulta.valores).toEqual(['["Cocina","Reparto"]']);
  });

  it('el orden es el mismo con alcance y sin él', () => {
    // The screens read the rows in upload order. A scoped account must see the same
    // sequence, or two people looking at the same day disagree about which row came first.
    expect(sqlListarFichadas(['Cocina']).texto).toContain(ORDEN);
  });

  it('un alcance vacío sigue filtrando: no devuelve todo', () => {
    const consulta = sqlListarFichadas([]);
    expect(consulta.texto).toContain('WHERE');
    expect(consulta.valores).toEqual(['[]']);
  });

  it('siempre califica el esquema compartido', () => {
    expect(sqlListarFichadas(null).texto).toContain('[controlhorario].[fichadas]');
    expect(sqlListarFichadas(['Cocina']).texto).toContain('[controlhorario].[fichadas]');
  });
});
