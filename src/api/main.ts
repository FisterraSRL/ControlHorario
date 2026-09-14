/**
 * The entry point of the `api` container.
 *
 * Order matters: configuration, then migrations, then listen. Migrations run BEFORE the
 * port is bound, so the server never accepts a request against a half-applied schema — a
 * request that would 503 in the best case and write into a table that is about to be
 * altered in the worst. `docker compose up` therefore either comes up correct or does not
 * come up, and the failure is on stdout.
 *
 * Set `API_MIGRAR_AL_INICIAR=false` and run `npm run db:migrate` yourself if you would
 * rather apply them by hand. The default is on: on this deployment there is one instance,
 * one operator, and nobody watching the logs at the moment of the restart.
 */

import { leerConfiguracion, ErrorConfiguracion } from './config.js';
import { crearPool } from './db.js';
import { errorParaLog } from './errores.js';
import { aplicarMigraciones } from './migraciones.js';
import { crearRepositorioConfiguracion } from './repositorioConfiguracion.js';
import { construirServidor } from './servidor.js';
import { limpiarSesionesVencidas } from './sesiones.js';

async function main(): Promise<void> {
  const config = leerConfiguracion();
  const pool = crearPool(config);
  const app = await construirServidor(config, pool);

  if (config.migrarAlIniciar) {
    const resultado = await aplicarMigraciones(pool, config.directorioMigraciones);
    app.log.info(
      {
        aplicadas: resultado.aplicadas.map((m) => m.version),
        yaEstaban: resultado.yaEstaban.length,
      },
      resultado.aplicadas.length > 0 ? 'migraciones aplicadas' : 'esquema al día',
    );
  }

  /**
   * Housekeeping, in this order, before the port is bound.
   *
   * Both are cheap, both are idempotent, and both are the kind of thing that never runs if
   * it depends on somebody remembering to run it.
   */
  const vencidas = await limpiarSesionesVencidas(pool);
  if (vencidas > 0) app.log.info({ sesiones: vencidas }, 'sesiones vencidas eliminadas');

  /**
   * The runtime exclusion seed, applied once per DNI ever.
   *
   * This is the port of `ensureDefaultExclusions()` from the legacy file, and the property
   * being preserved is the one that matters: an operator who takes somebody off the list in
   * Configuración does NOT find them back on it after the next restart. `exclusiones_semilla`
   * remembers that the seed already ran for that person; only a DNI nobody has ever seeded
   * is added.
   *
   * The DNIs come from the environment and never from a file in the repository. See the
   * comment on `exclusiones` in db/migrations/001_initial.sql for why that rule exists.
   */
  if (config.exclusionesIniciales.length > 0) {
    const configuracion = crearRepositorioConfiguracion(pool);
    const agregadas = await configuracion.sembrarExclusiones(
      config.exclusionesIniciales,
      config.operador,
    );
    // A count. Never the DNIs: this line goes to the log file that gets pasted into a chat.
    app.log.info(
      { recibidos: config.exclusionesIniciales.length, agregadas },
      'semilla de exclusiones aplicada',
    );
  }

  if (config.urlPublica === '') {
    app.log.warn(
      'APP_URL_PUBLICA está vacía: el servidor no sabe con qué dirección lo alcanzan desde ' +
        'afuera. Está bien en desarrollo; en el servidor de Fisterra hay que definirla.',
    );
  } else {
    app.log.info({ urlPublica: config.urlPublica }, 'dirección pública configurada');
  }

  let cerrando = false;
  const apagar = (senal: string): void => {
    if (cerrando) return;
    cerrando = true;
    app.log.info({ senal }, 'apagando');
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch((e: unknown) => {
        app.log.error(errorParaLog(e), 'el apagado falló');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));

  await app.listen({ host: config.host, port: config.puerto });
}

main().catch((e: unknown) => {
  // Before the logger exists there is nothing but stderr, and a container that dies at boot
  // has to say why in plain text: this is what `docker compose logs api` will show.
  if (e instanceof ErrorConfiguracion) {
    process.stderr.write(`\nConfiguración inválida: ${e.message}\n\n`);
  } else {
    process.stderr.write(`\nEl servidor no pudo arrancar: ${e instanceof Error ? e.message : String(e)}\n\n`);
  }
  process.exit(1);
});
