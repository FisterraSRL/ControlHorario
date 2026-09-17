/**
 * The decision layer, end to end: the absence registry, its two engine behaviours, the
 * configuration, and an attachment round-trip.
 *
 * All of it against the real Fastify app and a real Postgres. The two behaviours ported
 * from `legacy/app.html` — `syncAusenciasHistorial()` and `pruneStaleAusencias()` — are the
 * reason this file is not a set of unit tests over a fake: what makes them correct is the
 * `ON CONFLICT ... WHERE`, the CHECK constraints and the foreign keys, and none of those
 * exist outside Postgres.
 */

import { readdir } from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { crearRepositorioConfiguracion } from './repositorioConfiguracion.js';
import { levantarBase, reiniciarDatos, type BaseDePrueba } from './pruebas/basePrueba.js';
import {
  crearUsuarioDePrueba,
  cuerpoMultipart,
  filaAusencia,
  filaTrabajo,
  iniciarSesion,
  leerAusencias,
  subirFichadas,
} from './pruebas/ayudas.js';

let base: BaseDePrueba;
let cookie: string;

beforeAll(async () => {
  base = await levantarBase();
});

afterAll(async () => {
  await base.cerrar();
});

beforeEach(async () => {
  await reiniciarDatos(base);
  await crearUsuarioDePrueba(base.pool);
  cookie = await iniciarSesion(base);
});

// ============================================================================
// syncAusenciasHistorial
// ============================================================================

describe('sincronización del registro (syncAusenciasHistorial)', () => {
  it('creates a registry row for every day the engine reads as an absence', async () => {
    await subirFichadas(base, cookie, [
      filaTrabajo(),
      filaAusencia({ Fecha: '06/01/2026' }),
      filaAusencia({ Fecha: '07/01/2026', DNI: '11000002', Usuario: 'SOSA MARTIN' }),
    ]);

    const ausencias = await leerAusencias(base, cookie);
    expect(ausencias).toHaveLength(2);
    expect(ausencias.map((a) => `${String(a['dni'])}|${String(a['fecha'])}`).sort()).toEqual([
      '11000001|2026-01-06',
      '11000002|2026-01-07',
    ]);
    // Nobody has decided anything yet: that, and only that, is "sin clasificar".
    expect(ausencias.every((a) => a['motivoId'] === null)).toBe(true);
    expect(ausencias.every((a) => a['motivoSource'] === null)).toBe(true);
  });

  it('does not create a row for a worked day or for a franco', async () => {
    await subirFichadas(base, cookie, [
      filaTrabajo(),
      // "F: 0hs" is a franco, not a flexible shift. legacy/README.md says so explicitly.
      filaTrabajo({ Fecha: '06/01/2026', Turno: 'F: 0hs', Movimientos: '' }),
    ]);
    expect(await leerAusencias(base, cookie)).toHaveLength(0);
  });

  it('classifies the motivo from the QUICKPASS note, marked as coming from partes', async () => {
    await subirFichadas(base, cookie, [
      filaAusencia({ Fecha: '06/01/2026', Partes: 'Vacaciones de enero' }),
    ]);
    const [ausencia] = await leerAusencias(base, cookie);
    expect(ausencia).toMatchObject({ motivoId: 7, motivoSource: 'partes' });
    // A motivo the engine derived is not attributable to a person, and the CHECK in 001
    // only demands `resuelto_por` for a 'manual' one.
    expect(ausencia?.['resueltoPor']).toBeNull();
  });

  it('refreshes a partes-derived motivo when the note changes on a re-upload', async () => {
    await subirFichadas(base, cookie, [
      filaAusencia({ Fecha: '06/01/2026', Partes: 'Vacaciones' }),
    ]);
    expect((await leerAusencias(base, cookie))[0]).toMatchObject({ motivoId: 7 });

    await subirFichadas(base, cookie, [
      filaAusencia({ Fecha: '06/01/2026', Partes: 'Licencia enfermedad' }),
    ]);
    expect((await leerAusencias(base, cookie))[0]).toMatchObject({
      motivoId: 4,
      motivoSource: 'partes',
    });
  });

  it('is idempotent: uploading the same rows twice changes nothing', async () => {
    const filas = [filaAusencia({ Fecha: '06/01/2026' }), filaTrabajo()];
    await subirFichadas(base, cookie, filas);
    await subirFichadas(base, cookie, filas);
    expect(await leerAusencias(base, cookie)).toHaveLength(1);
  });

  it('ignores a row whose Fecha Postgres cannot store', async () => {
    await subirFichadas(base, cookie, [filaAusencia({ Fecha: 'sin fecha' })]);
    expect(await leerAusencias(base, cookie)).toHaveLength(0);
  });
});

// ============================================================================
// setMotivo, and the precedence rule
// ============================================================================

describe('asignación de motivo', () => {
  beforeEach(async () => {
    await subirFichadas(base, cookie, [filaAusencia({ Fecha: '06/01/2026' })]);
  });

  const asignar = (motivoId: number | null, fecha = '06/01/2026') =>
    base.app.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      headers: { cookie },
      payload: { dni: '11000001', fecha, motivoId },
    });

  it('records the choice as manual, with who decided it and when', async () => {
    const respuesta = await asignar(4);
    expect(respuesta.statusCode).toBe(200);
    const { ausencia } = respuesta.json() as { ausencia: Record<string, unknown> };
    expect(ausencia).toMatchObject({
      dni: '11000001',
      fecha: '2026-01-06',
      motivoId: 4,
      motivoSource: 'manual',
      resueltoPor: 'rrhh@ejemplo.test',
    });
    expect(ausencia['resueltoAt']).toBeTruthy();
  });

  it('audits the decision with the day it was about and no label', async () => {
    await asignar(4);
    const { rows } = await base.pool.query<{
      actor: string;
      entidad_id: string;
      datos: Record<string, unknown>;
    }>("SELECT actor, entidad_id, datos FROM controlhorario.auditoria WHERE accion = 'motivo_asignado'");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe('rrhh@ejemplo.test');
    expect(rows[0]?.entidad_id).toBe('11000001|2026-01-06');
    expect(rows[0]?.datos).toEqual({ motivoId: 4, motivoAnterior: null });
  });

  it('clears the motivo, and clearing is not the same as never having one', async () => {
    await asignar(4);
    const respuesta = await asignar(null);
    expect(respuesta.statusCode).toBe(200);
    const [ausencia] = await leerAusencias(base, cookie);
    expect(ausencia).toMatchObject({ motivoId: null, motivoSource: null });
    // The row survives: "sin clasificar" is a row with no motivo, not the absence of a row.
    expect(await leerAusencias(base, cookie)).toHaveLength(1);
  });

  it('refuses a day that is not in the evidence', async () => {
    const respuesta = await base.app.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      headers: { cookie },
      payload: { dni: '99999999', fecha: '06/01/2026', motivoId: 4 },
    });
    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json()).toMatchObject({ error: 'dia_sin_evidencia' });
  });

  it('refuses a date that is not DD/MM/AAAA', async () => {
    const respuesta = await asignar(4, '2026-01-06');
    expect(respuesta.statusCode).toBe(400);
  });

  /**
   * THE PRECEDENCE RULE. This is the one behaviour the legacy comment on
   * `syncAusenciasHistorial` calls out by name, and the one an operator would notice
   * immediately if it broke: they classify a day, somebody re-uploads the month, and their
   * decision is gone.
   */
  it('never lets a re-upload overwrite a motivo an operator chose by hand', async () => {
    await asignar(4);

    // The same day comes back, now with a QUICKPASS note that would classify as Vacaciones.
    await subirFichadas(base, cookie, [
      filaAusencia({ Fecha: '06/01/2026', Partes: 'Vacaciones' }),
    ]);

    const [ausencia] = await leerAusencias(base, cookie);
    expect(ausencia).toMatchObject({
      motivoId: 4,
      motivoSource: 'manual',
      resueltoPor: 'rrhh@ejemplo.test',
    });
  });

  it('does not overwrite a manager answer either', async () => {
    // Slice 3 writes these; the sync must not discard one when the evidence is re-uploaded.
    await base.pool.query(
      `UPDATE controlhorario.ausencias SET motivo_id = 2, motivo_source = 'encargado'
        WHERE dni = '11000001' AND fecha = '2026-01-06'`,
    );
    await subirFichadas(base, cookie, [
      filaAusencia({ Fecha: '06/01/2026', Partes: 'Vacaciones' }),
    ]);
    const [ausencia] = await leerAusencias(base, cookie);
    expect(ausencia).toMatchObject({ motivoId: 2, motivoSource: 'encargado' });
  });
});

// ============================================================================
// pruneStaleAusencias
// ============================================================================

describe('poda del registro (pruneStaleAusencias)', () => {
  it('removes an unclassified row once the day stops being an absence', async () => {
    await subirFichadas(base, cookie, [filaAusencia({ Fecha: '06/01/2026' })]);
    expect(await leerAusencias(base, cookie)).toHaveLength(1);

    // The corrected export has the punches after all: the day is worked, not absent.
    await subirFichadas(base, cookie, [filaTrabajo({ Fecha: '06/01/2026' })]);
    expect(await leerAusencias(base, cookie)).toHaveLength(0);
  });

  it('leaves a classified row alone, even when it is no longer an absence', async () => {
    await subirFichadas(base, cookie, [filaAusencia({ Fecha: '06/01/2026' })]);
    await base.app.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      headers: { cookie },
      payload: { dni: '11000001', fecha: '06/01/2026', motivoId: 4 },
    });

    await subirFichadas(base, cookie, [filaTrabajo({ Fecha: '06/01/2026' })]);

    const ausencias = await leerAusencias(base, cookie);
    expect(ausencias).toHaveLength(1);
    expect(ausencias[0]).toMatchObject({ motivoId: 4, motivoSource: 'manual' });
  });

  it('leaves an unclassified row alone when a file is attached to it', async () => {
    await subirFichadas(base, cookie, [filaAusencia({ Fecha: '06/01/2026' })]);
    await subirAdjunto(base, cookie, '11000001', '06/01/2026');

    await subirFichadas(base, cookie, [filaTrabajo({ Fecha: '06/01/2026' })]);

    const ausencias = await leerAusencias(base, cookie);
    expect(ausencias).toHaveLength(1);
    expect(ausencias[0]).toMatchObject({ motivoId: null, adjuntos: 1 });
  });

  it('never touches a day that is still an absence', async () => {
    await subirFichadas(base, cookie, [
      filaAusencia({ Fecha: '06/01/2026' }),
      filaAusencia({ Fecha: '07/01/2026' }),
    ]);
    await subirFichadas(base, cookie, [filaTrabajo({ Fecha: '06/01/2026' })]);

    const ausencias = await leerAusencias(base, cookie);
    expect(ausencias.map((a) => a['fecha'])).toEqual(['2026-01-07']);
  });
});

// ============================================================================
// Attachments
// ============================================================================

const FRONTERA = '----controlhorarioprueba';

async function subirAdjunto(
  b: BaseDePrueba,
  galleta: string,
  dni: string,
  fecha: string,
  opciones: {
    readonly nombre?: string;
    readonly tipo?: string;
    readonly contenido?: Buffer;
  } = {},
) {
  const cuerpo = cuerpoMultipart(
    FRONTERA,
    { dni, fecha },
    {
      campo: 'archivo',
      nombre: opciones.nombre ?? 'certificado.pdf',
      tipo: opciones.tipo ?? 'application/pdf',
      contenido: opciones.contenido ?? Buffer.from('%PDF-1.4 certificado de prueba', 'utf8'),
    },
  );
  return b.app.inject({
    method: 'POST',
    url: '/api/adjuntos',
    headers: {
      cookie: galleta,
      'content-type': `multipart/form-data; boundary=${FRONTERA}`,
    },
    payload: cuerpo,
  });
}

describe('adjuntos', () => {
  beforeEach(async () => {
    await subirFichadas(base, cookie, [filaAusencia({ Fecha: '06/01/2026' })]);
  });

  it('round-trips: upload, list, download the same bytes, delete', async () => {
    const contenido = Buffer.from('%PDF-1.4 contenido exacto del certificado', 'utf8');
    const subida = await subirAdjunto(base, cookie, '11000001', '06/01/2026', {
      nombre: 'certificado médico.pdf',
      contenido,
    });
    expect(subida.statusCode).toBe(201);
    const { adjunto } = subida.json() as { adjunto: Record<string, unknown> };
    expect(adjunto).toMatchObject({
      dni: '11000001',
      fecha: '2026-01-06',
      nombre: 'certificado médico.pdf',
      bytes: contenido.length,
      tipoMime: 'application/pdf',
      subidoPor: 'rrhh@ejemplo.test',
    });

    const listado = await base.app.inject({
      method: 'GET',
      url: '/api/adjuntos',
      headers: { cookie },
    });
    expect((listado.json() as { adjuntos: unknown[] }).adjuntos).toHaveLength(1);

    const descarga = await base.app.inject({
      method: 'GET',
      url: `/api/adjuntos/${String(adjunto['id'])}/archivo`,
      headers: { cookie },
    });
    expect(descarga.statusCode).toBe(200);
    expect(descarga.rawPayload.equals(contenido)).toBe(true);
    // Never rendered in the browser: saved.
    expect(descarga.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''certificado%20m%C3%A9dico.pdf",
    );
    expect(descarga.headers['content-type']).toBe('application/octet-stream');
    expect(descarga.headers['cache-control']).toBe('no-store, private');

    const borrado = await base.app.inject({
      method: 'DELETE',
      url: `/api/adjuntos/${String(adjunto['id'])}`,
      headers: { cookie },
    });
    expect(borrado.statusCode).toBe(204);
    expect((await base.app.inject({ method: 'GET', url: '/api/adjuntos', headers: { cookie } })).json()).toEqual({
      adjuntos: [],
    });
    expect(await readdir(base.dirAdjuntos)).toEqual([]);
  });

  it('stores the file under a generated name, never the operator\'s', async () => {
    await subirAdjunto(base, cookie, '11000001', '06/01/2026', {
      nombre: '../../../etc/passwd.pdf',
    });
    const enDisco = await readdir(base.dirAdjuntos);
    expect(enDisco).toHaveLength(1);
    expect(enDisco[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
    );

    /**
     * The name survives as data, which is what the screen shows — and busboy has already
     * stripped the directory part of it on the way in, so what reaches the database is
     * `passwd.pdf`. That stripping is a second line of defence and NOT the one being
     * tested: the assertion that matters is the one above, that the name on disk is a UUID
     * and owes nothing at all to whatever the client sent.
     */
    const { rows } = await base.pool.query<{ nombre: string; blob_path: string }>(
      'SELECT nombre, blob_path FROM controlhorario.adjuntos',
    );
    expect(rows[0]?.nombre).toBe('passwd.pdf');
    expect(rows[0]?.blob_path).not.toContain('passwd');
  });

  it('refuses a content type that is not on the allow-list', async () => {
    const respuesta = await subirAdjunto(base, cookie, '11000001', '06/01/2026', {
      nombre: 'planilla.xlsx',
      tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(respuesta.statusCode).toBe(415);
    expect(await readdir(base.dirAdjuntos)).toEqual([]);
  });

  it('refuses a file over the size limit and leaves nothing on disk', async () => {
    const enorme = Buffer.alloc(base.config.adjuntos.maxBytes + 1024, 0x41);
    const respuesta = await subirAdjunto(base, cookie, '11000001', '06/01/2026', {
      contenido: enorme,
    });
    expect(respuesta.statusCode).toBeGreaterThanOrEqual(400);
    expect(await readdir(base.dirAdjuntos)).toEqual([]);
    const { rows } = await base.pool.query<{ n: number }>(
      'SELECT count(*)::bigint AS n FROM controlhorario.adjuntos',
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('refuses a day that is not in the evidence, and keeps no file', async () => {
    const respuesta = await subirAdjunto(base, cookie, '99999999', '06/01/2026');
    expect(respuesta.statusCode).toBeGreaterThanOrEqual(400);
    expect(await readdir(base.dirAdjuntos)).toEqual([]);
  });

  it('records the download in auditoria', async () => {
    const subida = await subirAdjunto(base, cookie, '11000001', '06/01/2026');
    const { adjunto } = subida.json() as { adjunto: { id: number } };
    await base.app.inject({
      method: 'GET',
      url: `/api/adjuntos/${adjunto.id}/archivo`,
      headers: { cookie },
    });
    const { rows } = await base.pool.query<{ actor: string; entidad_id: string }>(
      "SELECT actor, entidad_id FROM controlhorario.auditoria WHERE accion = 'adjunto_descargado'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: 'rrhh@ejemplo.test',
      entidad_id: '11000001|2026-01-06',
    });
  });

  it('never puts the filename in the audit trail', async () => {
    await subirAdjunto(base, cookie, '11000001', '06/01/2026', {
      nombre: 'certificado psiquiatrico.pdf',
    });
    const { rows } = await base.pool.query<{ datos: Record<string, unknown> }>(
      "SELECT datos FROM controlhorario.auditoria WHERE accion = 'adjunto_subido'",
    );
    expect(JSON.stringify(rows[0]?.datos)).not.toContain('psiquiatrico');
  });

  it('cascades with the evidence: emptying the historial takes the files\' rows with it', async () => {
    await subirAdjunto(base, cookie, '11000001', '06/01/2026');
    await base.app.inject({ method: 'DELETE', url: '/api/fichadas', headers: { cookie } });
    const { rows } = await base.pool.query<{ n: number }>(
      'SELECT count(*)::bigint AS n FROM controlhorario.adjuntos',
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

// ============================================================================
// Configuración
// ============================================================================

describe('configuración', () => {
  it('reads the values migration 002 seeded', async () => {
    const respuesta = await base.app.inject({
      method: 'GET',
      url: '/api/configuracion',
      headers: { cookie },
    });
    expect(respuesta.statusCode).toBe(200);
    const cfg = respuesta.json() as {
      parametros: Record<string, number>;
      reglasSector: Record<string, number>;
      motivos: { id: number }[];
      exclusiones: unknown[];
    };
    expect(cfg.parametros).toEqual({
      descansoMaxMin: 30,
      toleranciaMin: 0,
      horasTurnoSemanales: 51,
    });
    expect(cfg.reglasSector).toEqual({ Reparto: 2, Cocina: 2, 'Administración': 2 });
    expect(cfg.motivos.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(cfg.exclusiones).toEqual([]);
  });

  it('saves a parameter and audits who changed it', async () => {
    const respuesta = await base.app.inject({
      method: 'PATCH',
      url: '/api/configuracion/parametros',
      headers: { cookie },
      payload: { toleranciaMin: 10 },
    });
    expect(respuesta.statusCode).toBe(200);
    expect((respuesta.json() as { parametros: Record<string, number> }).parametros).toMatchObject({
      toleranciaMin: 10,
      descansoMaxMin: 30,
    });

    const { rows } = await base.pool.query<{ actor: string; entidad_id: string }>(
      "SELECT actor, entidad_id FROM controlhorario.auditoria WHERE accion = 'config_actualizada'",
    );
    expect(rows[0]).toMatchObject({ actor: 'rrhh@ejemplo.test', entidad_id: 'tolerancia_min' });
  });

  it('refuses a sector rule that is not 2 or 4', async () => {
    const respuesta = await base.app.inject({
      method: 'PUT',
      url: '/api/configuracion/sectores',
      headers: { cookie },
      payload: { sector: 'Depósito', fichadasRequeridas: 3 },
    });
    expect(respuesta.statusCode).toBe(400);
  });

  it('saves a sector rule', async () => {
    const respuesta = await base.app.inject({
      method: 'PUT',
      url: '/api/configuracion/sectores',
      headers: { cookie },
      payload: { sector: 'Depósito', fichadasRequeridas: 2 },
    });
    expect(respuesta.statusCode).toBe(200);
    expect((respuesta.json() as { reglasSector: Record<string, number> }).reglasSector).toMatchObject({
      'Depósito': 2,
    });
  });

  it('adds a motivo with the next free id', async () => {
    const respuesta = await base.app.inject({
      method: 'POST',
      url: '/api/configuracion/motivos',
      headers: { cookie },
      payload: { label: 'Trámite gremial', worked: true },
    });
    expect(respuesta.statusCode).toBe(201);
    expect((respuesta.json() as { motivo: { id: number } }).motivo).toMatchObject({
      id: 10,
      label: 'Trámite gremial',
      worked: true,
    });
  });

  it('toggles the worked flag of a motivo', async () => {
    const respuesta = await base.app.inject({
      method: 'PATCH',
      url: '/api/configuracion/motivos/4',
      headers: { cookie },
      payload: { worked: false },
    });
    expect(respuesta.statusCode).toBe(200);
    expect((respuesta.json() as { motivo: { worked: boolean } }).motivo.worked).toBe(false);
  });

  /**
   * Retiring instead of deleting is not a nicety: `ausencias.motivo_id` references
   * `motivos` with ON DELETE RESTRICT, so a real DELETE of a motivo somebody used would
   * either fail or, worse, succeed for an unused one and set the precedent.
   */
  it('retires a motivo without breaking the decisions that used it', async () => {
    await subirFichadas(base, cookie, [filaAusencia({ Fecha: '06/01/2026' })]);
    await base.app.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      headers: { cookie },
      payload: { dni: '11000001', fecha: '06/01/2026', motivoId: 4 },
    });

    const respuesta = await base.app.inject({
      method: 'DELETE',
      url: '/api/configuracion/motivos/4',
      headers: { cookie },
    });
    expect(respuesta.statusCode).toBe(204);

    const cfg = (
      await base.app.inject({ method: 'GET', url: '/api/configuracion', headers: { cookie } })
    ).json() as { motivos: { id: number }[] };
    expect(cfg.motivos.map((m) => m.id)).not.toContain(4);

    // And the decision still points at a readable motivo.
    const { rows } = await base.pool.query<{ label: string }>(
      `SELECT m.label FROM controlhorario.ausencias a JOIN controlhorario.motivos m ON m.id = a.motivo_id`,
    );
    expect(rows[0]?.label).toBe('Enfermedad');
  });

  it('adds and removes an exclusion, recording who did it', async () => {
    const alta = await base.app.inject({
      method: 'POST',
      url: '/api/configuracion/exclusiones',
      headers: { cookie },
      payload: { dni: '11000001', motivoTexto: 'Acuerdo con el área' },
    });
    expect(alta.statusCode).toBe(201);
    expect((alta.json() as { exclusion: Record<string, unknown> }).exclusion).toMatchObject({
      dni: '11000001',
      creadoPor: 'rrhh@ejemplo.test',
    });

    const baja = await base.app.inject({
      method: 'DELETE',
      url: '/api/configuracion/exclusiones',
      headers: { cookie },
      payload: { dni: '11000001' },
    });
    expect(baja.statusCode).toBe(204);

    const cfg = (
      await base.app.inject({ method: 'GET', url: '/api/configuracion', headers: { cookie } })
    ).json() as { exclusiones: unknown[] };
    expect(cfg.exclusiones).toEqual([]);
  });
});

// ============================================================================
// The exclusion seed — the useful half of ensureDefaultExclusions()
// ============================================================================

describe('semilla de exclusiones', () => {
  it('applies once per DNI and never re-adds somebody an operator removed', async () => {
    const configuracion = crearRepositorioConfiguracion(base.pool);

    expect(await configuracion.sembrarExclusiones(['11000001', '11000002'], 'arranque')).toBe(2);
    expect((await configuracion.leer()).exclusiones.map((e) => e.dni)).toEqual([
      '11000001',
      '11000002',
    ]);

    // The operator takes one of them off the list by hand.
    await configuracion.quitarExclusion('11000001', 'rrhh@ejemplo.test');

    // The server restarts and the same seed runs again. It must add nothing.
    expect(await configuracion.sembrarExclusiones(['11000001', '11000002'], 'arranque')).toBe(0);
    expect((await configuracion.leer()).exclusiones.map((e) => e.dni)).toEqual(['11000002']);
  });

  it('does seed a DNI that is new to the list', async () => {
    const configuracion = crearRepositorioConfiguracion(base.pool);
    await configuracion.sembrarExclusiones(['11000001'], 'arranque');
    expect(await configuracion.sembrarExclusiones(['11000001', '11000003'], 'arranque')).toBe(1);
    expect((await configuracion.leer()).exclusiones.map((e) => e.dni)).toEqual([
      '11000001',
      '11000003',
    ]);
  });

  it('never writes a DNI into the audit row', async () => {
    const configuracion = crearRepositorioConfiguracion(base.pool);
    await configuracion.sembrarExclusiones(['11000001'], 'arranque');
    const { rows } = await base.pool.query<{ datos: unknown; entidad_id: string | null }>(
      "SELECT datos, entidad_id FROM controlhorario.auditoria WHERE accion = 'exclusiones_sembradas'",
    );
    expect(rows[0]?.entidad_id).toBeNull();
    expect(JSON.stringify(rows[0]?.datos)).not.toContain('11000001');
  });
});
