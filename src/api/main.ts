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
import { construirServidor } from './servidor.js';

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
