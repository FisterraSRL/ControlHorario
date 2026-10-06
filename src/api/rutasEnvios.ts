import type { FastifyInstance } from 'fastify';
import { ConflictoEnvio, esSnapshot, fechaValida, MAX_DOCUMENTOS, UUID, type MarcaVersionada, type PedidoEmision, type SnapshotPersona } from '../notificaciones/envios.js';
import { operadorDe, SOLO_RRHH } from './autenticacion.js';
import type { RepositorioEnviosSql } from './repositorioEnvios.js';
import { responderErrorDb } from './respuestas.js';
import { numeroSql, NUMERO_SQL } from './errores.js';

const id = { type: 'string', pattern: UUID.source };
const objeto = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const marca = objeto({ dni: { type: 'string', minLength: 1, maxLength: 32 }, fechaIso: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, tipo: { enum: ['incompleta', 'descanso', 'tardanza'] }, version: id, notificadoAt: { type: 'string', maxLength: 40 } });

export function registrarRutasEnvios(app: FastifyInstance, repo: RepositorioEnviosSql): void {
  const error = (e: unknown, req: Parameters<typeof responderErrorDb>[0], res: Parameters<typeof responderErrorDb>[1]) => {
    if (e instanceof ConflictoEnvio) return res.code(409).send({ error: 'cola_modificada', mensaje: e.message });
    if (numeroSql(e) === NUMERO_SQL.claveForaneaOCheck) return res.code(409).send({ error: 'datos_cambiaron', mensaje: 'Los datos cambiaron desde la preparación. No se emitió ningún documento. Descartá los pendientes afectados y volvé a prepararlos.' });
    responderErrorDb(req, res, e);
    return res;
  };
  app.get('/api/envios/pendientes', { onRequest: SOLO_RRHH }, async (req, res) => {
    try { return { documentos: await repo.pendientes() }; } catch (e) { return error(e, req, res); }
  });
  app.post<{ Body: { documentos: { id: string; snapshot: SnapshotPersona }[] } }>('/api/envios/pendientes', {
    onRequest: SOLO_RRHH, bodyLimit: 8_000_000,
    schema: { body: objeto({ documentos: { type: 'array', minItems: 1, maxItems: MAX_DOCUMENTOS, items: objeto({ id, snapshot: { type: 'object' } }) } }) },
  }, async (req, res) => {
    const docs = req.body.documentos;
    if (new Set(docs.map(d => d.id)).size !== docs.length || !docs.every(d => esSnapshot(d.snapshot))) return res.code(400).send({ mensaje: 'Los documentos tienen campos, fechas o tamaños inválidos.' });
    try { await repo.encolar(docs, operadorDe(req).email); return { ok: true }; } catch (e) { return error(e, req, res); }
  });
  app.post<{ Body: { id: string } }>('/api/envios/descartar', { onRequest: SOLO_RRHH, schema: { body: objeto({ id }) } }, async (req, res) => {
    try { await repo.descartar(req.body.id, operadorDe(req).email); return { ok: true }; } catch (e) { return error(e, req, res); }
  });
  app.post<{ Body: PedidoEmision }>('/api/envios/emitir', { onRequest: SOLO_RRHH, schema: { body: objeto({ id, documentos: { type: 'array', minItems: 1, maxItems: MAX_DOCUMENTOS, uniqueItems: true, items: id }, fechaDocumento: { type: 'string', maxLength: 10 } }) } }, async (req, res) => {
    if (!fechaValida(req.body.fechaDocumento)) return res.code(400).send({ mensaje: 'La fecha del documento no es válida.' });
    try { return { documentos: await repo.emitir(req.body, operadorDe(req).email) }; } catch (e) { return error(e, req, res); }
  });
  app.get<{ Querystring: { pagina?: string } }>('/api/envios/historial', { onRequest: SOLO_RRHH, schema: { querystring: { type: 'object', additionalProperties: false, properties: { pagina: { type: 'string', pattern: '^\\d{1,6}$' } } } } }, async (req, res) => {
    try { return await repo.historial(Number(req.query.pagina ?? '0')); } catch (e) { return error(e, req, res); }
  });
  app.post<{ Body: { marcas: MarcaVersionada[] } }>('/api/envios/quitar-notificado', { onRequest: SOLO_RRHH, schema: { body: objeto({ marcas: { type: 'array', minItems: 1, maxItems: 500, items: marca } }) } }, async (req, res) => {
    if (!req.body.marcas.every(m => fechaValida(m.fechaIso))) return res.code(400).send({ mensaje: 'Una fecha no es válida.' });
    try { await repo.quitar(req.body.marcas, operadorDe(req).email); return { ok: true }; } catch (e) { return error(e, req, res); }
  });
}
