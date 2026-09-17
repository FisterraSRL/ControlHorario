/** Applies the reviewed administrative bootstrap. It never creates a login or stores a secret. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { leerConfiguracion, ErrorConfiguracion } from './config.js';
import { crearPool } from './db.js';

async function main(): Promise<void> {
  const config = leerConfiguracion();
  const ruta = resolve(process.cwd(), 'db/bootstrap/000_esquema_y_rol.sql');
  const sql = await readFile(ruta, 'utf8');
  if (/^\s*GO\s*$/im.test(sql)) throw new Error('El bootstrap contiene GO y no es ejecutable por el driver.');

  const pool = crearPool(config);
  try {
    await pool.query(sql);
    process.stdout.write('Bootstrap aplicado: esquema y rol de ControlHorario disponibles.\n');
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  const prefijo = e instanceof ErrorConfiguracion ? 'Configuración inválida' : 'Bootstrap fallido';
  process.stderr.write(`${prefijo}: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
