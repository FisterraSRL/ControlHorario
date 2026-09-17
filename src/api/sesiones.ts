/**
 * Sessions: minting them, looking them up, and destroying them.
 *
 * THE COOKIE VALUE NEVER REACHES THE DATABASE. What is stored is its SHA-256, and the
 * lookup hashes the incoming cookie and searches for that. The reason is the same one
 * `solicitudes.token_hash` exists for in migration 001: a database dump is a file that ends
 * up on a pendrive, and a dump that contains live session tokens is a dump that lets whoever
 * holds it log in as an operator. A hash is not a credential.
 *
 * SHA-256 and not argon2, deliberately. This value is 256 bits of `randomBytes`, not
 * something a person chose: there is no dictionary to run against it and no amount of
 * stretching would help. Stretching it would only add ~50 ms of argon2 to EVERY
 * authenticated request.
 *
 * Invalidation is server-side by construction. Logout deletes the row, so the cookie is
 * dead the moment it is used again — which a self-contained signed token could not do
 * without a revocation list, i.e. without this table.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Pool, PoolClient } from './db.js';

/** 256 bits, base64url. Long enough that guessing is not a threat model. */
const BYTES_TOKEN = 32;

export interface Sesion {
  readonly id: string;
  readonly usuarioId: number;
  readonly email: string;
  readonly nombre: string;
  readonly expiraAt: Date;
}

export interface SesionCreada {
  /** The value that goes in the cookie. Held only long enough to be sent. */
  readonly token: string;
  readonly expiraAt: Date;
}

export function nuevoToken(): string {
  return randomBytes(BYTES_TOKEN).toString('base64url');
}

/** The primary key of `sesiones`. Hex SHA-256 of the cookie value. */
export function idDeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two session ids.
 *
 * Not used by the lookup — that goes through an index, and an index is not constant time by
 * nature — but by anything that compares two ids it already has in hand. Exported so the
 * comparison is never written as `===` somewhere else by accident.
 */
export function mismoId(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function crearSesion(
  cliente: Pool | PoolClient,
  usuarioId: number,
  horas: number,
): Promise<SesionCreada> {
  const token = nuevoToken();
  const { rows } = await cliente.query<{ expira_at: Date }>(
    `INSERT INTO [controlhorario].[sesiones] ([id], [usuario_id], [expira_at])
     OUTPUT inserted.[expira_at]
     VALUES ($1, $2, DATEADD(hour, $3, SYSUTCDATETIME()))`,
    [idDeToken(token), usuarioId, horas],
  );
  const expiraAt = rows[0]?.expira_at;
  if (!expiraAt) throw new Error('El INSERT en sesiones no devolvió expira_at.');
  return { token, expiraAt: new Date(expiraAt) };
}

/**
 * The session behind a cookie, or `null`.
 *
 * Expired rows and deactivated operators both come back as `null` from the same query, so
 * there is no branch above this that could forget one of them. Deactivating an account
 * therefore logs it out of every browser on the next request, without touching `sesiones`.
 */
export async function buscarSesion(
  cliente: Pool | PoolClient,
  token: string,
): Promise<Sesion | null> {
  const { rows } = await cliente.query<{
    id: string;
    usuario_id: number;
    email: string;
    nombre: string;
    expira_at: Date;
  }>(
    `SELECT s.[id], s.[usuario_id], u.[email], u.[nombre], s.[expira_at]
       FROM [controlhorario].[sesiones] s
       JOIN [controlhorario].[usuarios] u ON u.[id] = s.[usuario_id]
      WHERE s.[id] = $1 AND s.[expira_at] > SYSUTCDATETIME() AND u.[activo] = 1`,
    [idDeToken(token)],
  );
  const fila = rows[0];
  if (!fila) return null;
  return {
    id: fila.id,
    usuarioId: fila.usuario_id,
    email: fila.email,
    nombre: fila.nombre,
    expiraAt: new Date(fila.expira_at),
  };
}

/**
 * Pushes the expiry out, but only once the session is past its halfway point.
 *
 * A sliding expiry that wrote on every request would mean one UPDATE per API call, on the
 * screen that fires one per keystroke-free motivo change. The halfway rule makes it at most
 * one write per half-session per browser, and the operator still never gets logged out in
 * the middle of a working afternoon.
 *
 * Returns the new expiry when it moved, `null` when it did not.
 */
export async function renovarSesion(
  cliente: Pool | PoolClient,
  sesion: Sesion,
  horas: number,
): Promise<Date | null> {
  const restanteMs = sesion.expiraAt.getTime() - Date.now();
  if (restanteMs > (horas * 3_600_000) / 2) return null;
  const { rows } = await cliente.query<{ expira_at: Date }>(
    `UPDATE [controlhorario].[sesiones]
        SET [expira_at] = DATEADD(hour, $2, SYSUTCDATETIME()),
            [ultima_at] = SYSUTCDATETIME()
      OUTPUT inserted.[expira_at]
      WHERE [id] = $1`,
    [sesion.id, horas],
  );
  const nueva = rows[0]?.expira_at;
  return nueva ? new Date(nueva) : null;
}

/** Logout. Deleting rather than flagging: an expired session is not a fact worth keeping. */
export async function borrarSesion(cliente: Pool | PoolClient, token: string): Promise<boolean> {
  const { rowCount } = await cliente.query('DELETE FROM [controlhorario].[sesiones] WHERE [id] = $1', [
    idDeToken(token),
  ]);
  return (rowCount ?? 0) > 0;
}

/**
 * Drops every session that has already expired.
 *
 * Called at boot and nowhere else. Nothing depends on it — `buscarSesion` filters on
 * `expira_at` — it only keeps the table from growing forever on a server that is never
 * restarted for months.
 */
export async function limpiarSesionesVencidas(cliente: Pool | PoolClient): Promise<number> {
  const { rowCount } = await cliente.query(
    'DELETE FROM [controlhorario].[sesiones] WHERE [expira_at] <= SYSUTCDATETIME()',
  );
  return rowCount ?? 0;
}
