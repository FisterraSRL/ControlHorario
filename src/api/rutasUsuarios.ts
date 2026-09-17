import type { FastifyInstance, FastifyReply } from 'fastify';

import { operadorDe } from './autenticacion.js';
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

type Rol = 'admin' | 'operador';
interface Usuario { id: string; email: string; nombre: string; rol: Rol; activo: boolean; creado_at: Date }

function prohibido(respuesta: FastifyReply): FastifyReply {
  return respuesta.code(403).send({ error: 'solo_administradores', mensaje: 'Esta sección es sólo para administradores.' });
}

export function registrarRutasUsuarios(app: FastifyInstance, pool: Pool): void {
  app.get('/api/admin/usuarios', async (peticion, respuesta) => {
    if (operadorDe(peticion).rol !== 'admin') return prohibido(respuesta);
    try {
      const { rows } = await pool.query<Usuario>(
        `SELECT CONVERT(varchar(20), [id]) AS [id], [email], [nombre], [rol], [activo], [creado_at]
           FROM [controlhorario].[usuarios] ORDER BY [nombre], [email]`,
      );
      return respuesta.send({ usuarios: rows.map((u) => ({ ...u, creadoAt: new Date(u.creado_at).toISOString(), creado_at: undefined })) });
    } catch (e: unknown) { responderErrorDb(peticion, respuesta, e); }
  });

  app.post<{ Body: { email: string; nombre: string; rol: Rol } }>(
    '/api/admin/usuarios', { schema: { body: ESQUEMA_CUERPO_USUARIO_NUEVO } },
    async (peticion, respuesta) => {
      const actor = operadorDe(peticion);
      if (actor.rol !== 'admin') return prohibido(respuesta);
      const email = peticion.body.email.trim().toLowerCase();
      const nombre = peticion.body.nombre.trim();
      if (!email.includes('@') || email.startsWith('@') || nombre === '') {
        return respuesta.code(400).send({ error: 'datos_invalidos', mensaje: 'Revisá el nombre y el correo.' });
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
          await auditar(c, { actor: actor.email, accion: 'usuario_creado', entidad: 'usuarios', entidadId: String(creado.id), datos: { rol: creado.rol } });
          return creado;
        });
        return respuesta.code(201).send({ usuario: { ...usuario, creadoAt: new Date(usuario.creado_at).toISOString(), creado_at: undefined }, contrasenaTemporal });
      } catch (e: unknown) {
        if ([NUMERO_SQL.claveDuplicada, NUMERO_SQL.restriccionUnica].includes(numeroSql(e) as 2601 | 2627)) {
          return respuesta.code(409).send({ error: 'email_existente', mensaje: 'Ya existe un usuario con ese correo.' });
        }
        responderErrorDb(peticion, respuesta, e);
      }
    },
  );

  app.put<{ Body: { id: string; activo: boolean } }>(
    '/api/admin/usuarios/estado', { schema: { body: ESQUEMA_CUERPO_ESTADO_USUARIO } },
    async (peticion, respuesta) => {
      const actor = operadorDe(peticion);
      if (actor.rol !== 'admin') return prohibido(respuesta);
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
        return respuesta.send({ usuario: { ...actualizado, creadoAt: new Date(actualizado.creado_at).toISOString(), creado_at: undefined } });
      } catch (e: unknown) {
        if (e instanceof Error && e.message === 'ULTIMO_ADMIN') return respuesta.code(409).send({ error: 'ultimo_admin', mensaje: 'Tiene que quedar al menos un administrador activo.' });
        responderErrorDb(peticion, respuesta, e);
      }
    },
  );

  app.post<{ Body: { id: string } }>(
    '/api/admin/usuarios/reiniciar-contrasena', { schema: { body: ESQUEMA_CUERPO_ID_USUARIO } },
    async (peticion, respuesta) => {
      const actor = operadorDe(peticion);
      if (actor.rol !== 'admin') return prohibido(respuesta);
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
