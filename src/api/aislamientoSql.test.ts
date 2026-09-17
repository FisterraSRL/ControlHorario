import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const raiz = process.cwd();
const archivos = [
  'db/migrations/001_initial.sql',
  'db/migrations/002_acceso_y_decisiones.sql',
  'db/bootstrap/000_esquema_y_rol.sql',
];

describe('aislamiento de la base compartida', () => {
  it.each(archivos)('%s sólo crea objetos propios', async (ruta) => {
    const sql = await readFile(join(raiz, ruta), 'utf8');
    expect(sql).not.toMatch(/\[(?:dbo|centraliza|fstrack)\]\s*\.\s*\[/i);
    expect(sql).not.toMatch(/\bUSE\s+/i);
    expect(sql).not.toMatch(/^\s*GO\s*$/im);
  });

  it('no concede roles globales de lectura o escritura', async () => {
    const sql = await readFile(join(raiz, 'db/bootstrap/000_esquema_y_rol.sql'), 'utf8');
    expect(sql).not.toMatch(/ALTER\s+ROLE\s+\[(?:db_datareader|db_datawriter|db_owner)\]/i);
    expect(sql).toMatch(/ON\s+SCHEMA::\[controlhorario\]/i);
  });
});
