/**
 * The one HTTP client the adapters share.
 *
 * Extracted from `historial/repositorioHttp.ts` when the second adapter appeared. Three
 * things live here because they have to be the same everywhere:
 *
 * 1. `credentials: 'include'`. The session cookie is `httpOnly`, so the browser attaches it
 *    and nothing in this bundle can — but only if it is told to, and this is where it is
 *    told.
 *
 *    IT USED TO BE `'same-origin'`, WHICH IS NOW THE WRONG ANSWER. The app is served from
 *    Vercel and the API lives on Azure: two origins, so `'same-origin'` means the browser
 *    sends no cookie at all and every call after the login is a 401 — with the login itself
 *    appearing to succeed. `'include'` behaves identically for a same-origin call, so the
 *    local stack where this process also serves the SPA is unaffected.
 *
 *    `'include'` only works if the server plays its part: `Access-Control-Allow-Credentials:
 *    true` with one exact origin (never `*`, which the browser refuses in this combination),
 *    and a session cookie marked `SameSite=None; Secure`. See src/api/cors.ts and the
 *    `sesion.sameSite` comment in src/api/config.ts.
 *
 * 2. A 401 is not an error message, it is a state. Every call can get one — a session
 *    expires on a Friday afternoon like any other — and the app has to show the login
 *    screen rather than an alert saying "El servidor respondió 401". `ErrorNoAutenticado`
 *    is what the providers watch for.
 *
 * 3. The messages are written for the operator, not for a developer. Whoever is reading
 *    this screen at 11pm is the person who uploaded the spreadsheet, and "Failed to fetch"
 *    tells them nothing they can act on.
 */

/** Long enough for a year of QUICKPASS over a domestic uplink; short enough to not hang. */
export const TIEMPO_LIMITE_MS = 120_000;

export class ErrorApi extends Error {
  // Widened to `string` so the subclass below can narrow it to its own name. Declared at
  // all so a log line says which class it was without a `constructor.name` lookup.
  override readonly name: string = 'ErrorApi';
  constructor(
    mensaje: string,
    readonly estado: number | null = null,
  ) {
    super(mensaje);
  }
}

/** The session is gone. Not shown as an error: the app switches to the login screen. */
export class ErrorNoAutenticado extends ErrorApi {
  override readonly name = 'ErrorNoAutenticado';
  constructor(mensaje = 'Tu sesión terminó. Volvé a iniciar sesión.') {
    super(mensaje, 401);
  }
}

export function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * The server's own explanation when it sent one, and a plain sentence when it did not.
 * A 502 from the tunnel is an HTML page, not JSON, and reading it as JSON throws — which
 * is exactly the case that needs a readable message, so it is handled rather than raised.
 */
export async function mensajeDelError(respuesta: Response): Promise<string> {
  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = null;
  }
  if (esObjeto(cuerpo)) {
    const mensaje = cuerpo['mensaje'];
    if (typeof mensaje === 'string' && mensaje !== '') return mensaje;
  }
  if (respuesta.status === 502 || respuesta.status === 503 || respuesta.status === 504) {
    return (
      'El servidor no está respondiendo en este momento. Si acaba de reiniciarse puede ' +
      'tardar un minuto; si sigue así, avisá a quien administra el servidor.'
    );
  }
  return `El servidor respondió ${respuesta.status}.`;
}

export function errorDeRed(e: unknown): ErrorApi {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new ErrorApi(
      'El servidor tardó demasiado en responder y se canceló la operación. Los datos pueden ' +
        'haberse guardado igual: volvé a entrar y fijate antes de reintentar.',
    );
  }
  return new ErrorApi(
    'No se pudo contactar al servidor. Revisá la conexión a internet y volvé a intentar.',
  );
}

/**
 * A request that throws on anything but a 2xx.
 *
 * `lanzarEn401` exists for the one caller that must not throw on a 401: asking "is anybody
 * logged in?" and being told "no" is an answer, not a failure.
 */
export async function pedir(
  url: string,
  init: RequestInit = {},
  opciones: { readonly lanzarEn401?: boolean } = {},
): Promise<Response> {
  const { lanzarEn401 = true } = opciones;
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      credentials: 'include',
      ...init,
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });
  } catch (e: unknown) {
    throw errorDeRed(e);
  }
  if (respuesta.status === 401 && lanzarEn401) {
    throw new ErrorNoAutenticado(await mensajeDelError(respuesta));
  }
  if (!respuesta.ok && respuesta.status !== 401) {
    throw new ErrorApi(await mensajeDelError(respuesta), respuesta.status);
  }
  return respuesta;
}

/** A JSON body, or a readable error when the server sent something else. */
export async function leerJson(respuesta: Response): Promise<unknown> {
  try {
    return await respuesta.json();
  } catch {
    throw new ErrorApi('El servidor devolvió una respuesta que no se pudo leer.');
  }
}

export async function pedirJson(
  url: string,
  init: RequestInit = {},
  opciones: { readonly lanzarEn401?: boolean } = {},
): Promise<unknown> {
  return leerJson(await pedir(url, init, opciones));
}

/** `POST`/`PUT`/`PATCH` with a JSON body, spelled once. */
export function conJson(metodo: string, cuerpo: unknown): RequestInit {
  return {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  };
}
