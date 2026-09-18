import { describe, expect, it } from 'vitest';

import { crearPoolFalso } from './pruebas/dobles.js';
import {
  dentroDelAlcance,
  filtroDeSector,
  permiteElDia,
  sectorDelDia,
  valorDeAlcance,
} from './sectores.js';

describe('filtro SQL de sector', () => {
  it('expande la lista con OPENJSON sobre un único parámetro', () => {
    // A variable-length `IN ($1, $2, $3)` cannot survive the `$n` -> `@pn` rewrite in db.ts.
    // One JSON parameter can, and this is the precedent every scoped query follows.
    const sql = filtroDeSector("JSON_VALUE([payload], '$.Sector')", 1);
    expect(sql).toContain('OPENJSON($1)');
    expect(sql).toMatch(/IN \(SELECT CONVERT\(nvarchar\(200\), \[value\]\) FROM OPENJSON\(\$1\)\)/);
  });

  it('no confunde la ruta JSON con un parámetro', () => {
    // `$.Sector` starts with a `$` and must survive `parametrizar`, whose regexp only
    // matches `$` followed by digits. A `@p.Sector` in the query would be a runtime failure
    // in production and nowhere else.
    expect(filtroDeSector("JSON_VALUE([payload], '$.Sector')", 2)).toContain("'$.Sector'");
    expect(filtroDeSector("JSON_VALUE([payload], '$.Sector')", 2)).toContain('OPENJSON($2)');
  });

  it('el valor del parámetro es el arreglo serializado', () => {
    expect(valorDeAlcance(['Cocina', 'Reparto'])).toBe('["Cocina","Reparto"]');
    expect(valorDeAlcance([])).toBe('[]');
  });
});

describe('pertenencia de un día a un alcance', () => {
  it('sin restricción, cualquier sector pertenece', () => {
    expect(dentroDelAlcance('Cocina', null)).toBe(true);
    expect(dentroDelAlcance(null, null)).toBe(true);
  });

  it('un sector de la lista pertenece y otro no', () => {
    expect(dentroDelAlcance('Cocina', ['Cocina', 'Reparto'])).toBe(true);
    expect(dentroDelAlcance('Administración', ['Cocina', 'Reparto'])).toBe(false);
  });

  it('un día sin sector conocido nunca pertenece', () => {
    expect(dentroDelAlcance(null, ['Cocina'])).toBe(false);
  });

  it('un alcance vacío no deja pasar nada', () => {
    expect(dentroDelAlcance('Cocina', [])).toBe(false);
  });

  it('compara el sector completo, no un prefijo', () => {
    expect(dentroDelAlcance('Cocina Central', ['Cocina'])).toBe(false);
  });
});

describe('sector de un día puntual', () => {
  it('lo lee del payload QUICKPASS de esa fichada', async () => {
    const pool = crearPoolFalso(() => ({ rows: [{ sector: 'Cocina' }] }));
    await expect(sectorDelDia(pool, '11000001', '2026-01-05')).resolves.toBe('Cocina');
    expect(pool.llamadas[0]?.texto).toContain("JSON_VALUE([payload], '$.Sector')");
    expect(pool.llamadas[0]?.valores).toEqual(['11000001', '2026-01-05']);
  });

  it('un día sin fichada no tiene sector', async () => {
    const pool = crearPoolFalso(() => ({ rows: [] }));
    await expect(sectorDelDia(pool, '11000001', '2026-01-05')).resolves.toBeNull();
  });

  it('una fila sin la celda Sector tampoco', async () => {
    const pool = crearPoolFalso(() => ({ rows: [{ sector: null }] }));
    await expect(sectorDelDia(pool, '11000001', '2026-01-05')).resolves.toBeNull();
  });
});

describe('autorización de escritura sobre un día', () => {
  it('sin restricción no consulta la base', async () => {
    const pool = crearPoolFalso();
    await expect(permiteElDia(pool, null, '11000001', '2026-01-05')).resolves.toBe(true);
    expect(pool.llamadas).toHaveLength(0);
  });

  it('acepta un día del sector que supervisa', async () => {
    const pool = crearPoolFalso(() => ({ rows: [{ sector: 'Cocina' }] }));
    await expect(permiteElDia(pool, ['Cocina'], '11000001', '2026-01-05')).resolves.toBe(true);
  });

  it('rechaza un día de otro sector', async () => {
    const pool = crearPoolFalso(() => ({ rows: [{ sector: 'Reparto' }] }));
    await expect(permiteElDia(pool, ['Cocina'], '11000001', '2026-01-05')).resolves.toBe(false);
  });

  it('rechaza un día que no existe en fichadas', async () => {
    const pool = crearPoolFalso(() => ({ rows: [] }));
    await expect(permiteElDia(pool, ['Cocina'], '11000001', '2026-01-05')).resolves.toBe(false);
  });
});
