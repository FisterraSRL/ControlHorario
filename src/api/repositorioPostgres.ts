/**
 * The Postgres side of `RepositorioFichadas`.
 *
 * It implements exactly the three operations the port declares — `listar`, `upsert`,
 * `vaciar` — over the `fichadas` / `cargas` tables of `db/migrations/001_initial.sql`, and
 * nothing else. The HTTP layer above is a thin mapping onto these three.
 *
 * What is stored is the raw QUICKPASS row verbatim, in `payload`. Nothing derived is
 * persisted: no faults, no día type, no motivo. Same rule as the localStorage adapter, same
 * reason (README, decisions 6 and 7).
 *
 * TWO PLACES WHERE POSTGRES IS NOT localStorage, both deliberate:
 *
 * 1. `fichadas.fecha` is a `DATE` and half of the primary key, so a row whose `Fecha` cell
 *    is not `DD/MM/YYYY` cannot be stored at all. The localStorage adapter keys on the raw
 *    string and keeps such rows — `resumen.ts` even counts them as `diasSinFecha`. Here they
 *    are counted as `descartadas`, alongside the rows with no DNI. The date parser used to
 *    decide is `parsearFechaDMY`, imported from the engine, so "storable" means exactly
 *    "the engine can date it" and the two can never drift apart.
 *
 * 2. `payload` is `jsonb`, which normalises key order and discards duplicate keys. The
 *    values survive byte for byte (the reader hands over strings, `raw: false`), but a row
 *    read back may list its columns in a different order than the sheet did. Nothing reads
 *    a QUICKPASS row positionally, so this is invisible above the port.
 */

import { parsearFechaDMY } from '../domain/fichadas/parseo.js';
import type { FilaQuickpass } from '../domain/fichadas/tipos.js';
import { claveDeFila } from '../ui/historial/RepositorioFichadas.js';
import type { ClaveFichada, ResultadoGuardado } from '../ui/historial/RepositorioFichadas.js';
import { enTransaccion, type Pool, type PoolClient } from './db.js';

/**
 * Rows per INSERT. The whole upload is one transaction either way; this only bounds how
 * much of it is in flight in a single statement, and therefore the peak memory of the
 * driver's array encoding. A month of QUICKPASS for 200 people is about 6.000 rows.
 */
const TAMANO_LOTE = 2_000;

export interface DatosCarga {
  /** Goes to `cargas.archivo`. */
  readonly archivo: string;
  /** Goes to `cargas.subido_por`. */
  readonly subidoPor: string;
}

interface FilaPreparada {
  readonly dni: string;
  /** `YYYY-MM-DD`, ready for a `date[]` parameter. */
  readonly fechaIso: string;
  readonly fila: FilaQuickpass;
}

interface Preparacion {
  readonly filas: readonly FilaPreparada[];
  readonly descartadas: number;
  /** Same key twice in one upload, second copy identical to the first. */
  readonly duplicadasIguales: number;
  /** Same key twice in one upload, second copy different. */
  readonly duplicadasDistintas: number;
}

/**
 * Deduplicates the batch and drops what cannot be stored.
 *
 * `ON CONFLICT` cannot touch the same row twice in one statement, so a key repeated inside
 * one upload has to be collapsed here. Last occurrence wins — the same thing the
 * localStorage adapter's loop does — and the collapsed copies are folded back into the
 * counters afterwards so the operator's summary still adds up.
 */
function prepararFilas(filas: readonly FilaQuickpass[]): Preparacion {
  const porClave = new Map<ClaveFichada, FilaPreparada>();
  let descartadas = 0;
  let duplicadasIguales = 0;
  let duplicadasDistintas = 0;

  for (const fila of filas) {
    const clave = claveDeFila(fila);
    if (!clave) {
      descartadas++;
      continue;
    }
    const fecha = parsearFechaDMY(fila['Fecha']);
    if (!fecha) {
      descartadas++;
      continue;
    }
    const preparada: FilaPreparada = {
      dni: String(fila['DNI']),
      fechaIso: fecha.toISOString().slice(0, 10),
      fila,
    };
    const previa = porClave.get(clave);
    if (previa) {
      if (JSON.stringify(previa.fila) === JSON.stringify(fila)) duplicadasIguales++;
      else duplicadasDistintas++;
    }
    porClave.set(clave, preparada);
  }

  return {
    filas: [...porClave.values()],
    descartadas,
    duplicadasIguales,
    duplicadasDistintas,
  };
}

const SQL_UPSERT = `
  INSERT INTO fichadas (dni, fecha, payload, carga_id)
  SELECT t.dni, t.fecha, t.payload, $4
  FROM unnest($1::text[], $2::date[], $3::jsonb[]) AS t(dni, fecha, payload)
  ON CONFLICT (dni, fecha) DO UPDATE
    SET payload = EXCLUDED.payload,
        carga_id = EXCLUDED.carga_id
    WHERE fichadas.payload IS DISTINCT FROM EXCLUDED.payload
  RETURNING (xmax = '0'::xid) AS insertada
`;

interface ConteoLote {
  readonly nuevas: number;
  readonly actualizadas: number;
}

/**
 * `xmax` is zero on a tuple this statement inserted and non-zero on one it updated. Rows
 * skipped by the `WHERE` of `DO UPDATE` — the ones whose payload was already identical —
 * return nothing at all, which is how `sinCambios` is derived by subtraction.
 */
async function escribirLote(
  cliente: PoolClient,
  lote: readonly FilaPreparada[],
  cargaId: number,
): Promise<ConteoLote> {
  const { rows } = await cliente.query<{ insertada: boolean }>(SQL_UPSERT, [
    lote.map((f) => f.dni),
    lote.map((f) => f.fechaIso),
    lote.map((f) => JSON.stringify(f.fila)),
    cargaId,
  ]);
  let nuevas = 0;
  let actualizadas = 0;
  for (const r of rows) {
    if (r.insertada) nuevas++;
    else actualizadas++;
  }
  return { nuevas, actualizadas };
}

export interface RepositorioFichadasPostgres {
  listar(): Promise<readonly FilaQuickpass[]>;
  upsert(filas: readonly FilaQuickpass[], carga: DatosCarga): Promise<ResultadoGuardado>;
  vaciar(actor: string): Promise<number>;
  /** `true` when the database answered a trivial query. Used by `/health`. */
  alcanzable(): Promise<boolean>;
}

export function crearRepositorioPostgres(pool: Pool): RepositorioFichadasPostgres {
  return {
    /**
     * The port says "in insertion order". Postgres has no such thing, and `fichadas` has no
     * surrogate key to fake one with — the primary key is `(dni, fecha)`. Ordering by the
     * carga preserves insertion order at the granularity that means something (this upload
     * came after that one) and is then deterministic within it, which a hash-ordered scan
     * would not be. Nothing above the port depends on row order: every consumer either
     * aggregates into a Set, filters by period, or groups by week.
     */
    async listar() {
      const { rows } = await pool.query<{ payload: FilaQuickpass }>(
        'SELECT payload FROM fichadas ORDER BY carga_id, dni, fecha',
      );
      return rows.map((r) => r.payload);
    },

    async upsert(filas, carga) {
      const preparacion = prepararFilas(filas);

      return enTransaccion(pool, async (cliente) => {
        const { rows: filasCarga } = await cliente.query<{ id: number }>(
          'INSERT INTO cargas (archivo, subido_por, filas) VALUES ($1, $2, $3) RETURNING id',
          [carga.archivo, carga.subidoPor, preparacion.filas.length],
        );
        const cargaId = filasCarga[0]?.id;
        if (cargaId === undefined) throw new Error('El INSERT en cargas no devolvió un id.');

        let nuevas = 0;
        let actualizadas = 0;
        for (let i = 0; i < preparacion.filas.length; i += TAMANO_LOTE) {
          const lote = preparacion.filas.slice(i, i + TAMANO_LOTE);
          const conteo = await escribirLote(cliente, lote, cargaId);
          nuevas += conteo.nuevas;
          actualizadas += conteo.actualizadas;
        }

        const sinCambiosEnBase = preparacion.filas.length - nuevas - actualizadas;

        const { rows: filasTotal } = await cliente.query<{ n: number }>(
          'SELECT count(*)::bigint AS n FROM fichadas',
        );

        const resultado: ResultadoGuardado = {
          recibidas: filas.length,
          descartadas: preparacion.descartadas,
          nuevas,
          actualizadas: actualizadas + preparacion.duplicadasDistintas,
          sinCambios: sinCambiosEnBase + preparacion.duplicadasIguales,
          totalHistorial: filasTotal[0]?.n ?? 0,
        };

        // Counts only. A row of this table must never carry a DNI, a name or a payload:
        // `auditoria` is read by more people than `fichadas` is.
        await cliente.query(
          `INSERT INTO auditoria (actor, accion, entidad, entidad_id, datos)
           VALUES ($1, 'carga', 'cargas', $2, $3)`,
          [carga.subidoPor, String(cargaId), JSON.stringify(resultado)],
        );

        return resultado;
      });
    },

    /**
     * Drops the evidence and leaves the trail. `cargas` and `auditoria` are untouched on
     * purpose: "somebody emptied the historial on this date" is exactly the kind of fact
     * this system exists to still have months later. `ausencias` and `adjuntos` cascade
     * from `fichadas` by the schema's own foreign keys.
     */
    async vaciar(actor: string) {
      return enTransaccion(pool, async (cliente) => {
        const { rowCount } = await cliente.query('DELETE FROM fichadas');
        const borradas = rowCount ?? 0;
        await cliente.query(
          `INSERT INTO auditoria (actor, accion, entidad, entidad_id, datos)
           VALUES ($1, 'vaciar_historial', 'fichadas', NULL, $2)`,
          [actor, JSON.stringify({ borradas })],
        );
        return borradas;
      });
    },

    async alcanzable() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
  };
}
