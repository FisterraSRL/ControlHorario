/**
 * Every knob the API has, read from the process environment and nowhere else.
 *
 * There is no config file, and there is deliberately no default for anything secret. A
 * missing `PGPASSWORD` is a startup failure with a named variable in the message, not a
 * silent fallback to `postgres`/`postgres` that would leave the evidentiary database open
 * to whoever guesses first.
 *
 * Read once at boot into a frozen object. Nothing below this module reads `process.env`.
 */

import { resolve } from 'node:path';

export class ErrorConfiguracion extends Error {
  override readonly name = 'ErrorConfiguracion';
}

function texto(nombre: string, porDefecto?: string): string {
  const crudo = process.env[nombre];
  if (crudo !== undefined && crudo !== '') return crudo;
  if (porDefecto !== undefined) return porDefecto;
  throw new ErrorConfiguracion(
    `Falta la variable de entorno ${nombre}. Revisá el .env del servidor (docs/servidor.md).`,
  );
}

function entero(nombre: string, porDefecto: number): number {
  const crudo = process.env[nombre];
  if (crudo === undefined || crudo === '') return porDefecto;
  const n = Number(crudo);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ErrorConfiguracion(`${nombre} tiene que ser un entero positivo; llegó "${crudo}".`);
  }
  return n;
}

function booleano(nombre: string, porDefecto: boolean): boolean {
  const crudo = process.env[nombre]?.trim().toLowerCase();
  if (crudo === undefined || crudo === '') return porDefecto;
  if (['1', 'true', 'si', 'sí', 'yes', 'on'].includes(crudo)) return true;
  if (['0', 'false', 'no', 'off'].includes(crudo)) return false;
  throw new ErrorConfiguracion(`${nombre} tiene que ser true o false; llegó "${crudo}".`);
}

/**
 * Checked at boot, not at first use. A typo in `APP_URL_PUBLICA` that only surfaces the day
 * the first magic link goes out is a typo that goes out in an email to a department manager
 * with no way to recall it. The trailing slash is stripped so callers can always concatenate.
 */
function urlPublicaValida(crudo: string): string {
  if (crudo === '') return '';
  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    throw new ErrorConfiguracion(
      `APP_URL_PUBLICA no es una URL válida: "${crudo}". Se espera algo como ` +
        'https://controlhorario.tu-tailnet.ts.net',
    );
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new ErrorConfiguracion(
      `APP_URL_PUBLICA tiene que ser https (llegó "${url.protocol}//"). Los enlaces que se ` +
        'mandan por correo no pueden viajar en claro.',
    );
  }
  return crudo.replace(/\/+$/, '');
}

export interface ConfiguracionApi {
  readonly host: string;
  readonly puerto: number;
  /** Absolute path of the built SPA. Serving it is optional: missing means API-only. */
  readonly directorioEstatico: string;
  /** Absolute path of `db/migrations`. */
  readonly directorioMigraciones: string;
  /** Apply pending migrations during boot, before the first request is accepted. */
  readonly migrarAlIniciar: boolean;
  readonly nivelLog: string;
  /** Cap on an upload body. A year of QUICKPASS for 200 people is well under 32 MiB. */
  readonly limiteCuerpoBytes: number;
  /**
   * Who `cargas.subido_por` is attributed to. There is no authentication in this slice —
   * the Cloudflare Tunnel is the whole perimeter — so every upload is recorded against one
   * configured operator. See docs/servidor.md, "Lo que todavía no está resuelto".
   */
  readonly operador: string;
  /**
   * The address the outside world reaches this server at, e.g.
   * `https://controlhorario.tu-tailnet.ts.net`.
   *
   * The API never derives it from a `Host` header and never hardcodes it. The exposure
   * layer is an adapter — Tailscale Funnel today, a Cloudflare Tunnel on a Fisterra domain
   * once one exists — and swapping it has to be a change to `.env`, not to code. Slice 3
   * builds the magic links managers click from this value; a link built from a header is a
   * link an attacker can rewrite.
   *
   * Empty when nobody configured it, which is legitimate for a local `npm run dev`.
   */
  readonly urlPublica: string;
  readonly baseDeDatos: {
    readonly host: string;
    readonly puerto: number;
    readonly usuario: string;
    readonly contrasena: string;
    readonly base: string;
    readonly maxConexiones: number;
  };
}

export function leerConfiguracion(raizProyecto: string = process.cwd()): ConfiguracionApi {
  return Object.freeze({
    host: texto('API_HOST', '0.0.0.0'),
    puerto: entero('API_PUERTO', 8080),
    directorioEstatico: resolve(raizProyecto, texto('API_DIR_ESTATICO', 'dist')),
    directorioMigraciones: resolve(raizProyecto, texto('API_DIR_MIGRACIONES', 'db/migrations')),
    migrarAlIniciar: booleano('API_MIGRAR_AL_INICIAR', true),
    nivelLog: texto('API_NIVEL_LOG', 'info'),
    limiteCuerpoBytes: entero('API_LIMITE_CUERPO_BYTES', 32 * 1024 * 1024),
    operador: texto('API_OPERADOR', 'rrhh'),
    urlPublica: urlPublicaValida(texto('APP_URL_PUBLICA', '')),
    baseDeDatos: Object.freeze({
      host: texto('PGHOST', 'postgres'),
      puerto: entero('PGPORT', 5432),
      usuario: texto('PGUSER'),
      contrasena: texto('PGPASSWORD'),
      base: texto('PGDATABASE'),
      maxConexiones: entero('PG_MAX_CONEXIONES', 10),
    }),
  });
}
