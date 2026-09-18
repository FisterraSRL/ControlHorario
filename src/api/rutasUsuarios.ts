/**
 * The user administration panel, admin only.
 *
 *     GET    /api/admin/usuarios                      list, with each account's sectors
 *     POST   /api/admin/usuarios                      create, with a temporary password
 *     PUT    /api/admin/usuarios/estado               activate / deactivate
 *     POST   /api/admin/usuarios/reiniciar-contrasena reset somebody's password
 *
 * THE SCOPE OF AN `encargado` IS WRITTEN HERE AND NOWHERE ELSE. Migration 004 cannot express
 * "an encargado has at least one sector and everybody else has none": a CHECK sees one row of
 * one table and that rule spans `usuarios` and `usuarios_sectores`. So it is enforced below,
 * before the write and inside the transaction that performs it — the account and its sectors
 * land together or neither lands.
 *
 * There is no update endpoint. Changing somebody's role or sectors is not supported yet, and
 * a half-designed PUT would be a second place the invariant above has to be re-proved.
 */

import type { FastifyInstance } from 'fastify';

import { operadorDe, SOLO_ADMIN } from './autenticacion.js';
import { auditar } from './auditoria.js';
import { generarContrasenaTemporal, hashearContrasena } from './contrasenas.js';
import { enTransaccion, type Pool } from './db.js';
import { numeroSql, NUMERO_SQL } from './errores.js';
import {
  ESQUEMA_CUERPO_ESTADO_USUARIO,
  ESQUEMA_CUERPO_ID_USUARIO,
  ESQUEMA_CUERPO_USUARIO_NUEVO,
} from './esquemas.js';
import { responderErrorDb } from './respuestas.js';
import type { RolSesion } from './sesiones.js';

interface Usuario { id: string; email: string; nombre: string; rol: RolSesion; activo: boolean; creado_at: Date }

interface CuerpoUsuarioNuevo {
  readonly email: string;
  readonly nombre: string;
  readonly rol: RolSesion;
  readonly sectores?: readonly string[];
}

/** The JSON shape of one account. `creado_at` is dropped in favour of an ISO string. */
function comoUsuario(u: Usuario, sectores: readonly string[]): Record<string, unknown> {
  return {
    ...u,
    sectores,
    creadoAt: new Date(u.creado_at).toISOString(),
    creado_at: undefined,
  };
}

/** Trimmed, de-duplicated, blanks dropped. `CK_ch_usuarios_sectores_sector` agrees. */
function normalizarSectores(sectores: readonly string[] | undefined): readonly string[] {
  return [...new Set((sectores ?? []).map((s) => s.trim()).filter((s) => s !== ''))];
}

export function registrarRutasUsuarios(app: FastifyInstance, pool: Pool): void {
  app.get('/api/admin/usuarios', { onRequest: SOLO_ADMIN }, async (peticion, respuesta) => {
    try {
      /**
       * Two queries and a join in memory, rather than one query with an aggregate.
       *
       * This is a three-person tool and the second result set is a handful of short strings;
       * `STRING_AGG` would mean picking a separator no sector name may contain, and
       * `FOR JSON` would mean parsing a column `db.ts` does not know to parse.
       */
      const [usuarios, asignados] = await Promise.all([
        pool.query<Usuario>(
          `SELECT CONVERT(varchar(20), [id]) AS [id], [email], [nombre], [rol], [activo], [creado_at]
             FROM [controlhorario].[usuarios] ORDER BY [nombre], [email]`,
        ),
        pool.query<{ usuario_id: string; sector: string }>(
          `SELECT CONVERT(varchar(20), [usuario_id]) AS [usuario_id], [sector]
             FROM [controlhorario].[usuarios_sectores] ORDER BY [usuario_id], [sector]`,
        ),
      ]);
      const porUsuario = new Map<string, string[]>();
      for (const fila of asignados.rows) {
        const actuales = porUsuario.get(fila.usuario_id);
        if (actuales) actuales.push(fila.sector);
        else porUsuario.set(fila.usuario_id, [fila.sector]);
      }
      return respuesta.send({
        usuarios: usuarios.rows.map((u) => comoUsuario(u, porUsuario.get(u.id) ?? [])),
      });
    } catch (e: unknown) { responderErrorDb(peticion, respuesta, e); }
  });

  app.post<{ Body: CuerpoUsuarioNuevo }>(
    '/api/admin/usuarios',
    { schema: { body: ESQUEMA_CUERPO_USUARIO_NUEVO }, onRequest: SOLO_ADMIN },
    async (peticion, respuesta) => {
      const actor = operadorDe(peticion);
      const email = peticion.body.email.trim().toLowerCase();
      const nombre = peticion.body.nombre.trim();
      if (!email.includes('@') || email.startsWith('@') || nombre === '') {
        return respuesta.code(400).send({ error: 'datos_invalidos', mensaje: 'Revisá el nombre y el correo.' });
      }

      /**
       * The pairing, rejected in both directions.
       *
       * An encargado with no sectors would be an account that can log in and see nothing —
       * not a safe default, a confusing one. A non-encargado with sectors would be rows
       * nothing reads, which is worse: they would come back to life the day somebody changed
       * that account's role.
       */
      const sectores = normalizarSectores(peticion.body.sectores);
      if (peticion.body.rol === 'encargado' && sectores.length === 0) {
        return respuesta.code(400).send({
          error: 'sectores_requeridos',
          mensaje: 'Un encargado tiene que supervisar al menos un sector.',
        });
      }
      if (peticion.body.rol !== 'encargado' && (peticion.body.sectores?.length ?? 0) > 0) {
        return respuesta.code(400).send({
          error: 'sectores_no_corresponden',
          mensaje: 'Sólo un encargado puede tener sectores asignados.',
        });
      }

      const contrasenaTemporal = generarContrasenaTemporal();
      try {
        const hash = await hashearContrasena(contrasenaTemporal);
        const usuario = await enTransaccion(pool, async (c) => {
          const { rows } = await c.query<Usuario>(
            `INSERT INTO [controlhorario].[usuarios] ([email], [nombre], [hash_contrasena], [rol])
             OUTPUT inserted.[id], inserted.[email], inserted.[nombre], inserted.[rol], inserted.[activo], inserted.[creado_at]
             VALUES ($1, $2, $3, $4)`, [email, nombre, hash, peticion.body.rol],
          );
          const creado = rows[0];
          if (!creado) throw new Error('No se pudo leer el usuario creado.');
          if (sectores.length > 0) {
            // One statement for the whole list: see `sectores.ts` for why a variable-length
            // list travels as one JSON parameter instead of as `IN ($1, $2, ...)`.
            await c.query(
              `INSERT INTO [controlhorario].[usuarios_sectores] ([usuario_id], [sector])
               SELECT $1, CONVERT(nvarchar(200), [value]) FROM OPENJSON($2)`,
              [creado.id, JSON.stringify(sectores)],
            );
          }
          // Sector names are organisational, not personal: they name a part of the company,
          // the way `rol` does, and which sectors an account was granted is exactly what an
          // audit of a permission change has to be able to answer.
          await auditar(c, { actor: actor.email, accion: 'usuario_creado', entidad: 'usuarios', entidadId: String(creado.id), datos: { rol: creado.rol, sectores } });
          return creado;
        });
        return respuesta.code(201).send({ usuario: comoUsuario(usuario, sectores), contrasenaTemporal });
      } catch (e: unknown) {
        if ([NUMERO_SQL.claveDuplicada, NUMERO_SQL.restriccionUnica].includes(numeroSql(e) as 2601 | 2627)) {
          return respuesta.code(409).send({ error: 'email_existente', mensaje: 'Ya existe un usuario con ese correo.' });
        }
        responderErrorDb(peticion, respuesta, e);
      }
    },
  );

  app.put<{ Body: { id: string; activo: boolean } }>(
    '/api/admin/usuarios/estado',
    { schema: { body: ESQUEMA_CUERPO_ESTADO_USUARIO }, onRequest: SOLO_ADMIN },
    async (peticion, respuesta) => {
      const actor = operadorDe(peticion);
      if (!peticion.body.activo && peticion.body.id === String(actor.usuarioId)) {
        return respuesta.code(409).send({ error: 'cuenta_propia', mensaje: 'No podés desactivar tu propia cuenta.' });
      }
      try {
        const actualizado = await enTransaccion(pool, async (c) => {
          const { rows } = await c.query<Usuario>(
            `SELECT CONVERT(varchar(20), [id]) AS [id], [email], [nombre], [rol], [activo], [creado_at]
               FROM [controlhorario].[usuarios] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = $1`, [peticion.body.id],
          );
          const actual = rows[0];
          if (!actual) return null;
          // Counts admins, so an encargado neither helps nor blocks it. Left exactly as it was.
          if (!peticion.body.activo && actual.rol === 'admin') {
            const cuenta = await c.query<{ cantidad: number }>(
              `SELECT COUNT_BIG(*) AS [cantidad] FROM [controlhorario].[usuarios] WITH (UPDLOCK, HOLDLOCK)
                WHERE [rol] = N'admin' AND [activo] = 1 AND [id] <> $1`, [actual.id],
            );
            if ((cuenta.rows[0]?.cantidad ?? 0) === 0) throw new Error('ULTIMO_ADMIN');
          }
          const { rows: cambiados } = await c.query<Usuario>(
            `UPDATE [controlhorario].[usuarios] SET [activo] = $2, [actualizado_at] = SYSUTCDATETIME()
             OUTPUT inserted.[id], inserted.[email], inserted.[nombre], inserted.[rol], inserted.[activo], inserted.[creado_at]
             WHERE [id] = $1`, [actual.id, peticion.body.activo],
          );
          if (!peticion.body.activo) await c.query('DELETE FROM [controlhorario].[sesiones] WHERE [usuario_id] = $1', [actual.id]);
          await auditar(c, { actor: actor.email, accion: peticion.body.activo ? 'usuario_activado' : 'usuario_desactivado', entidad: 'usuarios', entidadId: String(actual.id), datos: null });
          return cambiados[0] ?? null;
        });
        if (!actualizado) return respuesta.code(404).send({ error: 'no_encontrado', mensaje: 'El usuario ya no existe.' });
        const { rows: sectores } = await pool.query<{ sector: string }>(
          `SELECT [sector] FROM [controlhorario].[usuarios_sectores]
            WHERE [usuario_id] = $1 ORDER BY [sector]`, [actualizado.id],
        );
        return respuesta.send({ usuario: comoUsuario(actualizado, sectores.map((s) => s.sector)) });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === 'ULTIMO_ADMIN') return respuesta.code(409).send({ error: 'ultimo_admin', mensaje: 'Tiene que quedar al menos un administrador activo.' });
        responderErrorDb(peticion, respuesta, e);
      }
    },
  );

  app.post<{ Body: { id: string } }>(
    '/api/admin/usuarios/reiniciar-contrasena',
    { schema: { body: ESQUEMA_CUERPO_ID_USUARIO }, onRequest: SOLO_ADMIN },
    async (peticion, respuesta) => {
      const actor = operadorDe(peticion);
      const contrasenaTemporal = generarContrasenaTemporal();
      try {
        const hash = await hashearContrasena(contrasenaTemporal);
        const existe = await enTransaccion(pool, async (c) => {
          const cambio = await c.query(
            `UPDATE [controlhorario].[usuarios] SET [hash_contrasena] = $2, [actualizado_at] = SYSUTCDATETIME() WHERE [id] = $1`,
            [peticion.body.id, hash],
          );
          if (cambio.rowCount === 0) return false;
          await c.query('DELETE FROM [controlhorario].[sesiones] WHERE [usuario_id] = $1 AND [usuario_id] <> $2', [peticion.body.id, actor.usuarioId]);
          await auditar(c, { actor: actor.email, accion: 'contrasena_reiniciada', entidad: 'usuarios', entidadId: String(peticion.body.id), datos: null });
          return true;
        });
        if (!existe) return respuesta.code(404).send({ error: 'no_encontrado', mensaje: 'El usuario ya no existe.' });
        return respuesta.send({ contrasenaTemporal });
      } catch (e: unknown) { responderErrorDb(peticion, respuesta, e); }
    },
  );
}
