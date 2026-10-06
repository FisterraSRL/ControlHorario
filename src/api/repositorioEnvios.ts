import { randomUUID } from 'node:crypto';
import {
  comprobarCola, clavesSnapshot, ConflictoEnvio, esSnapshot, TAMANO_HISTORIAL,
  type DocumentoPendiente, type DocumentoEmitido, type MarcaVersionada, type PedidoEmision,
  type RepositorioEnvios, type SnapshotPersona,
} from '../notificaciones/envios.js';
import { auditar } from './auditoria.js';
import { enTransaccion, type Consultable, type Pool, type PoolClient } from './db.js';

interface FilaDocumento { id: string; snapshot: string; creado_at: Date | string; emision_id: string; emitido_at: Date | string; fecha_documento: string }
interface FilaMarca { dni: string; fecha: string; tipo: MarcaVersionada['tipo']; version: string; notificado_at: Date | string; documento_id: string | null }
const iso = (v: Date | string) => v instanceof Date ? v.toISOString() : v;
function pendiente(f: FilaDocumento): DocumentoPendiente {
  const snapshot: unknown = JSON.parse(f.snapshot);
  if (!esSnapshot(snapshot)) throw new Error('Invalid persisted notification snapshot');
  return { id: f.id, snapshot, creadoAt: iso(f.creado_at) };
}
function marca(f: FilaMarca): MarcaVersionada { return { dni: f.dni, fechaIso: f.fecha, tipo: f.tipo, version: f.version, notificadoAt: iso(f.notificado_at) }; }
const SELECT_DOCUMENTOS = `SELECT d.[id], d.[snapshot], d.[creado_at], d.[emision_id], e.[emitido_at], CONVERT(char(10), e.[fecha_documento], 23) AS [fecha_documento]
 FROM [controlhorario].[documentos_notificacion] d LEFT JOIN [controlhorario].[emisiones] e ON e.[id] = d.[emision_id]`;
const SELECT_MARCAS = `SELECT n.[dni], CONVERT(char(10), n.[fecha], 23) AS [fecha], n.[tipo], n.[version], n.[notificado_at], n.[documento_id] FROM [controlhorario].[faltas_notificadas] n`;
async function cola(c: Consultable) {
  const { rows } = await c.query<FilaDocumento>(`${SELECT_DOCUMENTOS} WHERE d.[emision_id] IS NULL AND d.[descartado_at] IS NULL ORDER BY d.[creado_at], d.[id]`);
  return rows.map(pendiente);
}
async function emitidos(c: Consultable, filas: readonly FilaDocumento[]): Promise<DocumentoEmitido[]> {
  if (!filas.length) return [];
  const { rows } = await c.query<FilaMarca>(`${SELECT_MARCAS} WHERE n.[documento_id] IN (SELECT [value] FROM OPENJSON($1))`, [JSON.stringify(filas.map(f => f.id))]);
  return filas.map(f => ({ ...pendiente(f), emisionId: f.emision_id, emitidoAt: iso(f.emitido_at), fechaDocumento: f.fecha_documento, activas: rows.filter(m => m.documento_id === f.id).map(marca) }));
}
export interface RepositorioEnviosSql extends Omit<RepositorioEnvios, 'encolar' | 'descartar' | 'emitir' | 'quitar'> {
  encolar(documentos: readonly { readonly id: string; readonly snapshot: SnapshotPersona }[], actor: string): Promise<void>;
  descartar(id: string, actor: string): Promise<void>;
  emitir(pedido: PedidoEmision, actor: string): Promise<readonly DocumentoEmitido[]>;
  quitar(marcas: readonly MarcaVersionada[], actor: string): Promise<void>;
}
export function crearRepositorioEnvios(pool: Pool): RepositorioEnviosSql {
  // A single row serializes short queue transitions, including two different request ids.
  // No process-local mutex and no privileges outside this schema are needed.
  const escribir = <T>(fn: (c: PoolClient) => Promise<T>) => enTransaccion(pool, async c => {
    await c.query('SELECT [id] FROM [controlhorario].[envios_mutex] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = 1');
    return fn(c);
  });
  return {
    pendientes: () => cola(pool),
    async encolar(documentos, actor) {
      await escribir(async c => {
        const actuales = await cola(c);
        const nuevos: typeof documentos[number][] = [];
        for (const d of documentos) {
          const { rows } = await c.query<{ snapshot: string; emision_id: string | null; descartado_at: unknown }>('SELECT [snapshot], [emision_id], [descartado_at] FROM [controlhorario].[documentos_notificacion] WHERE [id] = $1', [d.id]);
          if (rows[0]) {
            if (rows[0].snapshot !== JSON.stringify(d.snapshot)) throw new ConflictoEnvio('La preparación ya existe con otro contenido.');
            continue; // An exact retry never resurrects an emitted/discarded document.
          }
          nuevos.push(d);
        }
        comprobarCola(actuales, nuevos);
        for (const d of nuevos) {
          await c.query('INSERT INTO [controlhorario].[documentos_notificacion] ([id], [snapshot], [creado_por]) VALUES ($1, $2, $3)', [d.id, JSON.stringify(d.snapshot), actor]);
          await auditar(c, { actor, accion: 'documento_preparado', entidad: 'documentos_notificacion', entidadId: d.id, datos: { faltas: clavesSnapshot(d.snapshot).length } });
        }
      });
    },
    async descartar(id, actor) {
      await escribir(async c => {
        const { rows } = await c.query<{ emision_id: string | null }>('SELECT [emision_id] FROM [controlhorario].[documentos_notificacion] WHERE [id] = $1', [id]);
        if (!rows[0] || rows[0].emision_id) throw new ConflictoEnvio('El documento ya no está pendiente. Actualizá el panel.');
        await c.query('UPDATE [controlhorario].[documentos_notificacion] SET [descartado_at] = SYSUTCDATETIME() WHERE [id] = $1 AND [descartado_at] IS NULL', [id]);
        await auditar(c, { actor, accion: 'documento_descartado', entidad: 'documentos_notificacion', entidadId: id });
      });
    },
    async emitir(pedido, actor) {
      return escribir(async c => {
        const ids = [...pedido.documentos].sort();
        const { rows: anterior } = await c.query<{ documentos: string; fecha_documento: string }>('SELECT [documentos], CONVERT(char(10), [fecha_documento], 23) AS [fecha_documento] FROM [controlhorario].[emisiones] WHERE [id] = $1', [pedido.id]);
        if (anterior[0]) {
          if (anterior[0].documentos !== JSON.stringify(ids) || anterior[0].fecha_documento !== pedido.fechaDocumento) throw new ConflictoEnvio('El identificador de emisión pertenece a otra selección.');
        } else {
          const actuales = await cola(c);
          const elegidos = actuales.filter(d => ids.includes(d.id));
          if (elegidos.length !== ids.length) throw new ConflictoEnvio('Otro operador cambió los pendientes. Actualizá el panel antes de generar.');
          await c.query('INSERT INTO [controlhorario].[emisiones] ([id], [documentos], [fecha_documento], [actor]) VALUES ($1, $2, CONVERT(date, $3), $4)', [pedido.id, JSON.stringify(ids), pedido.fechaDocumento, actor]);
          // Updating existing marks transfers ownership to the latest emission. Version
          // comparisons on removal protect it from actions on an older document.
          const marcas = elegidos.flatMap(d => clavesSnapshot(d.snapshot).map(k => ({ ...k, documento: d.id, version: randomUUID() })));
          await c.query(`MERGE [controlhorario].[faltas_notificadas] WITH (HOLDLOCK) AS destino
            USING (SELECT * FROM OPENJSON($1) WITH ([dni] nvarchar(32), [fechaIso] date, [tipo] nvarchar(16), [documento] nvarchar(36), [version] nvarchar(36))) AS origen
            ON destino.[dni] = origen.[dni] AND destino.[fecha] = origen.[fechaIso] AND destino.[tipo] = origen.[tipo]
            WHEN MATCHED THEN UPDATE SET [documento_id] = origen.[documento], [version] = origen.[version], [notificado_por] = $2, [notificado_at] = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT ([dni], [fecha], [tipo], [documento_id], [version], [notificado_por]) VALUES (origen.[dni], origen.[fechaIso], origen.[tipo], origen.[documento], origen.[version], $2);`, [JSON.stringify(marcas), actor]);
          await c.query('UPDATE [controlhorario].[documentos_notificacion] SET [emision_id] = $1 WHERE [id] IN (SELECT [value] FROM OPENJSON($2))', [pedido.id, JSON.stringify(ids)]);
          await auditar(c, { actor, accion: 'documentos_emitidos', entidad: 'emisiones', entidadId: pedido.id, datos: { documentos: ids.length, faltas: marcas.length } });
        }
        const { rows } = await c.query<FilaDocumento>(`${SELECT_DOCUMENTOS} WHERE d.[emision_id] = $1 ORDER BY d.[creado_at], d.[id]`, [pedido.id]);
        return emitidos(c, rows);
      });
    },
    async historial(pagina) {
      const { rows } = await pool.query<FilaDocumento>(`${SELECT_DOCUMENTOS} WHERE d.[emision_id] IS NOT NULL ORDER BY e.[emitido_at] DESC, d.[id] OFFSET $1 ROWS FETCH NEXT $2 ROWS ONLY`, [pagina * TAMANO_HISTORIAL, TAMANO_HISTORIAL + 1]);
      const { rows: anteriores } = await pool.query<FilaMarca>(`${SELECT_MARCAS} WHERE n.[documento_id] IS NULL ORDER BY n.[notificado_at] DESC, n.[dni], n.[fecha], n.[tipo] OFFSET $1 ROWS FETCH NEXT $2 ROWS ONLY`, [pagina * TAMANO_HISTORIAL, TAMANO_HISTORIAL + 1]);
      return { documentos: await emitidos(pool, rows.slice(0, TAMANO_HISTORIAL)), anteriores: anteriores.slice(0, TAMANO_HISTORIAL).map(marca), hayMas: rows.length > TAMANO_HISTORIAL || anteriores.length > TAMANO_HISTORIAL };
    },
    async quitar(marcas, actor) {
      await escribir(async c => {
        const { rows } = await c.query<{ version: string }>(`DELETE n OUTPUT deleted.[version] FROM [controlhorario].[faltas_notificadas] n JOIN OPENJSON($1)
          WITH ([dni] nvarchar(32), [fechaIso] date, [tipo] nvarchar(16), [version] nvarchar(36)) p
          ON n.[dni] = p.[dni] AND n.[fecha] = p.[fechaIso] AND n.[tipo] = p.[tipo] AND n.[version] = p.[version]`, [JSON.stringify(marcas)]);
        await auditar(c, { actor, accion: 'notificado_quitado', entidad: 'faltas_notificadas', datos: { versiones: rows.map(r => r.version), quitadas: rows.length } });
      });
    },
  };
}
