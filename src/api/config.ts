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

/**
 * Comma/whitespace separated list, empty entries dropped. Used for the runtime exclusion
 * seed, whose values are DNIs and therefore never appear in a committed file.
 */
function lista(nombre: string): readonly string[] {
  const crudo = process.env[nombre];
  if (crudo === undefined) return [];
  return crudo
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/**
 * The file types an attachment may be. Medical certificates arrive as a phone photo or a
 * scan, and that is the whole list: an allow-list, not a deny-list, and the extension the
 * file is stored under is derived from THIS table rather than from the name the operator's
 * computer happened to give it.
 */
export const TIPOS_ADJUNTO_PERMITIDOS: Readonly<Record<string, string>> = Object.freeze({
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
});

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
   * The actor recorded for anything the server does with nobody logged in: the boot-time
   * exclusion seed, and the migration runner.
   *
   * It is NO LONGER the author of an upload. Every `/api/*` route now runs behind a
   * session, so `cargas.subido_por` and `auditoria.actor` carry the email of the operator
   * who actually did it. See `autenticacion.ts`.
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
  readonly sesion: {
    /** Cookie name. Deliberately boring: it says nothing about the stack behind it. */
    readonly cookie: string;
    /**
     * `Secure` on the session cookie. TRUE BY DEFAULT, and it has to be: the app is on the
     * public internet through the tunnel and a session cookie that can travel over plain
     * HTTP is a session cookie that can be read off a café network.
     *
     * The only reason to turn it off is a local `npm run dev` on `http://localhost`, where
     * the browser refuses to store a Secure cookie and the login silently never sticks.
     */
    readonly segura: boolean;
    /** How long a session lives. A workday, so nobody is logged out mid-afternoon. */
    readonly horas: number;
  };
  readonly adjuntos: {
    /** Absolute path of the directory the files live in. A Docker volume in production. */
    readonly directorio: string;
    /** Per-file cap. A phone photo of a certificate is 2-5 MB; 10 MiB is generous. */
    readonly maxBytes: number;
  };
  /**
   * DNIs to put on the exclusion list the first time the server sees each one, and only the
   * first time. THIS IS PERSONAL DATA AND IT LIVES IN `.env`, WHICH IS GITIGNORED — the
   * whole point of the `exclusiones` table is that the six names the legacy file hardcoded
   * never enter source control again. See `exclusiones_semilla` in migration 002.
   */
  readonly exclusionesIniciales: readonly string[];
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
    sesion: Object.freeze({
      cookie: texto('API_COOKIE_SESION', 'ch_sesion'),
      segura: booleano('API_COOKIE_SEGURA', true),
      horas: entero('API_SESION_HORAS', 12),
    }),
    adjuntos: Object.freeze({
      directorio: resolve(raizProyecto, texto('API_DIR_ADJUNTOS', 'datos/adjuntos')),
      maxBytes: entero('API_ADJUNTO_MAX_BYTES', 10 * 1024 * 1024),
    }),
    exclusionesIniciales: Object.freeze(lista('EXCLUSIONES_INICIALES')),
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
