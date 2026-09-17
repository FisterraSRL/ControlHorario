/**
 * Every knob the API has, read from the process environment and nowhere else.
 *
 * There is no config file, and there is deliberately no default for anything secret. A
 * missing `DB_PASSWORD` is a startup failure with a named variable in the message, not a
 * silent fallback that would leave the evidentiary database open
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
    `Falta la variable de entorno ${nombre}. Revisá el .env del servidor (docs/stack-local.md).`,
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

function puertoApi(): number {
  const original = process.env['API_PUERTO'];
  if (original !== undefined && original !== '') return entero('API_PUERTO', 8080);
  return entero('PORT', 8080);
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
        'https://controlhorario.vercel.app',
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
 * The exact origin the Vercel frontend is served from, e.g. `https://algo.vercel.app`.
 *
 * ORIGIN ONLY: scheme, host and port. A path, a query or a trailing slash would never match
 * the `Origin` header a browser sends, and the symptom of that is every request from the
 * app failing CORS while `curl` works perfectly — which is a bad afternoon. So it is
 * normalised here, at boot, and anything that is not a parseable absolute URL is a startup
 * failure with the variable named.
 *
 * Empty is legitimate and means "no cross-origin frontend": the local stack, where the API
 * serves the SPA itself and every call is same-origin.
 */
function origenValido(crudo: string): string {
  if (crudo === '') return '';
  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    throw new ErrorConfiguracion(
      `APP_ORIGEN_FRONTEND no es una URL válida: "${crudo}". Se espera el origen completo y ` +
        'nada más, por ejemplo https://controlhorario.vercel.app',
    );
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new ErrorConfiguracion(
      `APP_ORIGEN_FRONTEND tiene que ser https (llegó "${url.protocol}//"). La cookie de ` +
        'sesión viaja a ese origen.',
    );
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new ErrorConfiguracion(
      `APP_ORIGEN_FRONTEND tiene que ser solo el origen, sin ruta ni parámetros: llegó ` +
        `"${crudo}", se esperaba "${url.origin}". El navegador manda exactamente el origen ` +
        'en el encabezado Origin y la comparación es carácter por carácter.',
    );
  }
  return url.origin;
}

/**
 * `SameSite` on the session cookie. See the long comment on `sesion.sameSite` below.
 */
function sameSiteValido(crudo: string): 'lax' | 'strict' | 'none' {
  const v = crudo.trim().toLowerCase();
  if (v === 'lax' || v === 'strict' || v === 'none') return v;
  throw new ErrorConfiguracion(
    `API_COOKIE_SAMESITE tiene que ser lax, strict o none; llegó "${crudo}".`,
  );
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
   * The address a PERSON opens, e.g. `https://controlhorario.vercel.app`.
   *
   * Not the same thing as `origenFrontend` even though today they are the same string:
   * this is what goes INTO a link that gets emailed, and that one is what the API compares
   * an incoming `Origin` header against. They would differ the day a custom domain points
   * at Vercel and the old address still answers.
   *
   * The API never derives it from a `Host` header and never hardcodes it. The exposure
   * layer is an adapter — Vercel today, the office tunnel before it, a Fisterra domain
   * whenever one exists — and swapping it has to be a change to configuration, not to
   * code. Slice 3 builds the magic links managers click from this value; a link built from
   * a header is a link an attacker can rewrite.
   *
   * Empty when nobody configured it, which is legitimate for a local `npm run dev`.
   */
  readonly urlPublica: string;
  /**
   * The exact origin the frontend is served from, or `''` when it is served by this API.
   *
   * With Vercel in front, the browser loads the app from `https://…vercel.app` and calls
   * this API on an Azure hostname. Two origins, so the browser applies CORS, and the API
   * has to name the one origin it answers for.
   *
   * ONE ORIGIN, NEVER `*`. A wildcard is not even legal together with credentials — the
   * browser refuses the pair — and this API answers with the whole company's DNIs, legajos
   * and sick leaves to anyone holding a session cookie. An allow-list that grew would be the
   * beginning of one that has `*` in it.
   */
  readonly origenFrontend: string;
  readonly sesion: {
    /** Cookie name. Deliberately boring: it says nothing about the stack behind it. */
    readonly cookie: string;
    /**
     * `Secure` on the session cookie. TRUE BY DEFAULT, and it has to be: the app is on the
     * public internet and a session cookie that can travel over plain HTTP is a session
     * cookie that can be read off a café network.
     *
     * The only reason to turn it off is a local `npm run dev` on `http://localhost`, where
     * the browser refuses to store a Secure cookie and the login silently never sticks.
     */
    readonly segura: boolean;
    /**
     * `SameSite` on the session cookie. THIS IS THE SETTING MOST LIKELY TO BREAK THE VERCEL
     * DEPLOYMENT, so it is worth the paragraphs.
     *
     * `lax` — the previous value, and still the right one when this API serves the SPA
     * itself. A `lax` cookie is not attached to a cross-SITE request at all except a
     * top-level GET navigation, which is exactly the CSRF protection we want, and `fetch`
     * from the same site still carries it.
     *
     * `none` — required when the frontend is on Vercel and the API is on Azure. Those are
     * different sites (different registrable domains), so with `lax` the browser sends the
     * login request, stores nothing, and every following call is a 401. The login "works"
     * and the session never sticks: no error in the console, nothing in the server log.
     *
     * THE CONSEQUENCES OF `none`, PLAINLY. It means the cookie IS attached to cross-site
     * requests, including a POST from a page an attacker controls. The browser-level CSRF
     * protection that `lax` gave for free is gone, and what replaces it is:
     *
     *   * the CORS allow-list — one exact origin, never `*`, so a script on another origin
     *     cannot READ any answer;
     *   * every write being a JSON POST/PUT/DELETE, which is not a "simple request" and so
     *     cannot leave a browser at all without a successful preflight from an allowed
     *     origin.
     *
     * That combination is what makes `none` acceptable here, and it is why the CORS list
     * must never gain a second casual entry. If this app ever accepts a
     * `application/x-www-form-urlencoded` POST, that reasoning stops holding and it needs a
     * CSRF token.
     *
     * DEFAULT: `none` when `APP_ORIGEN_FRONTEND` is set, `lax` when it is not. That gets the
     * current deployment right without a knob nobody remembers, and leaves the local stack
     * exactly as it was. Override it with `API_COOKIE_SAMESITE` for the one case the default
     * gets wrong: an API and a frontend on two subdomains of the SAME registrable domain
     * (`app.fisterra.com.ar` / `api.fisterra.com.ar`), which is cross-origin but same-site,
     * where `lax` works and is stricter.
     *
     * `none` without `Secure` is silently dropped by every current browser, so that
     * combination is refused at boot rather than debugged at 23:00.
     */
    readonly sameSite: 'lax' | 'strict' | 'none';
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
    /**
     * Connections this process may hold open AT ONCE. Five, and the number is the shared
     * server talking.
     *
     * The Azure SQL database also serves Centraliza and FSTrack. A small pool prevents this
     * pilot from consuming a disproportionate share of workers/connections while RRHH's
     * real concurrency is only a handful of requests.
     *
     * Five covers what actually happens at once: a couple of overlapping screen reads, the
     * one long upload transaction, and a spare so that a slow query cannot make the next
     * request wait for a free connection. The pool queues past that rather than failing, and
     * `idleTimeoutMillis` hands connections back after thirty seconds idle, so the steady
     * state overnight is zero.
     *
     * Raise it only after measuring the shared database and consulting the owners of the
     * other projects.
     */
    readonly maxConexiones: number;
  };
}

export function leerConfiguracion(raizProyecto: string = process.cwd()): ConfiguracionApi {
  const origenFrontend = origenValido(texto('APP_ORIGEN_FRONTEND', ''));
  const cookieSegura = booleano('API_COOKIE_SEGURA', true);
  // The default is derived rather than fixed. See `sesion.sameSite` above: with a Vercel
  // frontend the only value that works is `none`, and a wrong default here does not fail —
  // it logs everybody out one request after they log in.
  const cookieSameSite = sameSiteValido(
    texto('API_COOKIE_SAMESITE', origenFrontend === '' ? 'lax' : 'none'),
  );

  /**
   * Refused at boot, because the browser refuses it silently.
   *
   * `SameSite=None` without `Secure` is dropped outright by Chrome, Firefox and Safari. The
   * server sets the header, the response carries it, nothing logs a warning, and the
   * operator gets a login screen again on the next click. That is a whole evening of
   * looking at the wrong layer, and it costs one `if` to make impossible.
   */
  if (cookieSameSite === 'none' && !cookieSegura) {
    throw new ErrorConfiguracion(
      'API_COOKIE_SAMESITE=none exige API_COOKIE_SEGURA=true. Los navegadores descartan sin ' +
        'decir nada una cookie SameSite=None que no sea Secure, así que el login parecería ' +
        'funcionar y la sesión no quedaría guardada nunca.',
    );
  }

  return Object.freeze({
    host: texto('API_HOST', '0.0.0.0'),
    puerto: puertoApi(),
    directorioEstatico: resolve(raizProyecto, texto('API_DIR_ESTATICO', 'dist')),
    directorioMigraciones: resolve(raizProyecto, texto('API_DIR_MIGRACIONES', 'db/migrations')),
    migrarAlIniciar: booleano('API_MIGRAR_AL_INICIAR', false),
    nivelLog: texto('API_NIVEL_LOG', 'info'),
    limiteCuerpoBytes: entero('API_LIMITE_CUERPO_BYTES', 32 * 1024 * 1024),
    operador: texto('API_OPERADOR', 'rrhh'),
    urlPublica: urlPublicaValida(texto('APP_URL_PUBLICA', '')),
    origenFrontend,
    sesion: Object.freeze({
      cookie: texto('API_COOKIE_SESION', 'ch_sesion'),
      segura: cookieSegura,
      sameSite: cookieSameSite,
      horas: entero('API_SESION_HORAS', 12),
    }),
    adjuntos: Object.freeze({
      directorio: resolve(raizProyecto, texto('API_DIR_ADJUNTOS', 'datos/adjuntos')),
      maxBytes: entero('API_ADJUNTO_MAX_BYTES', 10 * 1024 * 1024),
    }),
    exclusionesIniciales: Object.freeze(lista('EXCLUSIONES_INICIALES')),
    baseDeDatos: Object.freeze({
      host: texto('DB_SERVER'),
      puerto: entero('DB_PORT', 1433),
      usuario: texto('DB_USER'),
      contrasena: texto('DB_PASSWORD'),
      base: texto('DB_NAME'),
      maxConexiones: entero('DB_MAX_CONEXIONES', 5),
    }),
  });
}
