/**
 * Fixtures and small helpers shared by the API tests.
 *
 * NO REAL DATA. Every person here is invented: the names are ordinary Argentine surnames
 * chosen at random and the DNIs are outside any range in use. Real payroll data never
 * enters this repository — see the Privacy section of the README — and a fixture is a file
 * in git like any other.
 */

import type { FilaQuickpass } from '../../domain/fichadas/index.js';
import { hashearContrasena } from '../contrasenas.js';
import type { Pool } from '../db.js';
import type { BaseDePrueba } from './basePrueba.js';

export const CONTRASENA_PRUEBA = 'una-contrasena-larga-de-prueba';

/** Creates an operator directly, the way `npm run crear-usuario` does. */
export async function crearUsuarioDePrueba(
  pool: Pool,
  email = 'rrhh@ejemplo.test',
  nombre = 'Operadora De Prueba',
  contrasena = CONTRASENA_PRUEBA,
): Promise<number> {
  const hash = await hashearContrasena(contrasena);
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO usuarios (email, nombre, hash_contrasena) VALUES ($1, $2, $3) RETURNING id',
    [email, nombre, hash],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('No se pudo crear el usuario de prueba.');
  return id;
}

/**
 * Logs in and returns the raw `Cookie` header to send on later requests.
 *
 * `app.inject` does not keep a cookie jar, which is a feature here: every test that needs a
 * session has to have obtained one, so a route that stopped requiring authentication would
 * not be covered by accident.
 */
export async function iniciarSesion(
  base: BaseDePrueba,
  email = 'rrhh@ejemplo.test',
  contrasena = CONTRASENA_PRUEBA,
): Promise<string> {
  const respuesta = await base.app.inject({
    method: 'POST',
    url: '/api/sesion',
    payload: { email, contrasena },
  });
  if (respuesta.statusCode !== 200) {
    throw new Error(`El login de prueba falló con ${respuesta.statusCode}: ${respuesta.body}`);
  }
  const cookie = respuesta.cookies.find((c) => c.name === base.config.sesion.cookie);
  if (!cookie) throw new Error('El login no devolvió la cookie de sesión.');
  return `${cookie.name}=${cookie.value}`;
}

/** A full worked day: four punches, nothing wrong with it. */
export function filaTrabajo(extra: FilaQuickpass = {}): FilaQuickpass {
  return {
    Sector: 'Depósito',
    Usuario: 'GOMEZ LAURA',
    DNI: '11000001',
    Legajo: '900',
    Fecha: '05/01/2026',
    Turno: '08:00 - 17:00',
    Movimientos: '08:00 - 12:00 - 12:25 - 17:00',
    'Horas Turno': '9:00',
    Horas: '8:35',
    'Cantidad Tarde': '',
    Partes: '',
    ...extra,
  };
}

/** A day with a shift and no punches at all: `tipoDia === 'ausencia'`. */
export function filaAusencia(extra: FilaQuickpass = {}): FilaQuickpass {
  return filaTrabajo({
    Movimientos: '',
    Horas: '',
    ...extra,
  });
}

export async function subirFichadas(
  base: BaseDePrueba,
  cookie: string,
  filas: readonly FilaQuickpass[],
): Promise<{ statusCode: number; body: unknown }> {
  const respuesta = await base.app.inject({
    method: 'POST',
    url: '/api/fichadas',
    headers: { cookie },
    payload: { filas },
  });
  return { statusCode: respuesta.statusCode, body: respuesta.json() };
}

/** The registry, as `GET /api/ausencias` returns it. */
export async function leerAusencias(
  base: BaseDePrueba,
  cookie: string,
): Promise<readonly Record<string, unknown>[]> {
  const respuesta = await base.app.inject({
    method: 'GET',
    url: '/api/ausencias',
    headers: { cookie },
  });
  if (respuesta.statusCode !== 200) {
    throw new Error(`GET /api/ausencias devolvió ${respuesta.statusCode}`);
  }
  return (respuesta.json() as { ausencias: Record<string, unknown>[] }).ausencias;
}

/**
 * A multipart body, assembled by hand.
 *
 * `form-data` and friends are not worth a dependency for four fields, and building it here
 * makes the exact bytes the upload route parses visible in the test.
 */
export function cuerpoMultipart(
  frontera: string,
  campos: Readonly<Record<string, string>>,
  archivo: { readonly campo: string; readonly nombre: string; readonly tipo: string; readonly contenido: Buffer },
): Buffer {
  const partes: Buffer[] = [];
  for (const [clave, valor] of Object.entries(campos)) {
    partes.push(
      Buffer.from(
        `--${frontera}\r\nContent-Disposition: form-data; name="${clave}"\r\n\r\n${valor}\r\n`,
        'utf8',
      ),
    );
  }
  partes.push(
    Buffer.from(
      `--${frontera}\r\nContent-Disposition: form-data; name="${archivo.campo}"; ` +
        `filename="${archivo.nombre}"\r\nContent-Type: ${archivo.tipo}\r\n\r\n`,
      'utf8',
    ),
    archivo.contenido,
    Buffer.from(`\r\n--${frontera}--\r\n`, 'utf8'),
  );
  return Buffer.concat(partes);
}
