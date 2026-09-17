/**
 * `npm run db:migrate` — applies pending migrations and exits.
 *
 * The same runner the server calls at boot, with a human-readable report instead of JSON
 * log lines. Use it when `API_MIGRAR_AL_INICIAR=false`, when you want to apply a new
 * migration without restarting the API, or when you want to see what a fresh database is
 * about to get before it gets it.
 *
 * Exit codes: 0 applied or already up to date, 1 anything else. Safe to run twice.
 */

import { leerConfiguracion, ErrorConfiguracion } from './config.js';
import { crearPool } from './db.js';
import { aplicarMigraciones, ErrorMigracion } from './migraciones.js';

function escribir(linea: string): void {
  process.stdout.write(`${linea}\n`);
}

async function main(): Promise<void> {
  const verificarSolamente = process.argv.includes('--dry-run');
  const config = leerConfiguracion();
  const pool = crearPool(config);

  escribir('');
  escribir(`Base:        ${config.baseDeDatos.base} en ${config.baseDeDatos.host}:${config.baseDeDatos.puerto}`);
  escribir(`Migraciones: ${config.directorioMigraciones}`);
  escribir('');

  try {
    const resultado = await aplicarMigraciones(pool, config.directorioMigraciones, {
      confirmar: !verificarSolamente,
    });

    for (const version of resultado.yaEstaban) {
      escribir(`  ya estaba   ${version}`);
    }
    for (const m of resultado.aplicadas) {
      escribir(`  ${resultado.confirmadas ? 'APLICADA' : 'VALIDADA'}   ${m.version}  (${m.duracionMs} ms)`);
    }

    escribir('');
    if (!resultado.confirmadas) {
      escribir('Validación correcta. La transacción se revirtió: no se creó ni modificó nada.');
    } else if (resultado.aplicadas.length === 0) {
      escribir('El esquema ya estaba al día. No se cambió nada.');
    } else {
      escribir(`Listo: ${resultado.aplicadas.length} migración/es aplicada/s.`);
    }
    escribir('');
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write('\n');
  if (e instanceof ErrorConfiguracion) {
    process.stderr.write(`Configuración inválida: ${e.message}\n`);
  } else if (e instanceof ErrorMigracion) {
    process.stderr.write(`No se pudieron aplicar las migraciones.\n\n${e.message}\n`);
  } else {
    process.stderr.write(
      `No se pudieron aplicar las migraciones: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
  process.stderr.write('\n');
  process.exit(1);
});
