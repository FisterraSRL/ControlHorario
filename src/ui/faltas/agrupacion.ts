/**
 * The ONE definition of "faltas per person" in the period.
 *
 * Notificaciones needs it to build its Word documents and Indicador counts the same buckets,
 * so it lives here rather than inside either screen: two independent groupings would be two
 * chances for the letter and the dashboard to disagree about how many faltas somebody has.
 * The two screens differ only in whether clean people are listed (`incluirSinFaltas`), never
 * in how a falta is counted.
 *
 * Pure, like `src/ui/periodo/periodo.ts` and the domain engine: no React, no I/O. It takes
 * the derived records and hands back exactly the `NotificacionPersona` shape the
 * notificaciones module already consumes — the rows are pre-formatted text, because the
 * numbers in a disciplinary letter must be the numbers the operator saw on screen.
 *
 * Faithful port of `groupFaultsByPerson` (legacy/app.html ~lines 1154-1184).
 */

import {
  fmtMinutos,
  fmtReloj,
  type ConfiguracionFichadas,
  type RegistroDia,
} from '../../domain/fichadas/index.js';
import {
  SIN_DATO,
  type FaltasPorTipo,
  type ItemDescanso,
  type ItemFaltaBase,
  type ItemIncompleta,
  type ItemTardanza,
  type NotificacionPersona,
} from '../../notificaciones/index.js';
import { dentroDelPeriodo, type RangoPeriodo } from '../periodo/periodo.js';

/** Break allowance when the configuration does not set one, as in the engine itself. */
const DESCANSO_MAX_POR_DEFECTO = 30;

/** Mutable while a person is being built; materialised as readonly on the way out. */
interface Acumulador {
  usuario: string;
  dni: string;
  sector: string;
  legajo: string;
  incompleta: ItemIncompleta[];
  descanso: ItemDescanso[];
  tardanza: ItemTardanza[];
}

/**
 * Chronological, with undated rows last.
 *
 * The legacy sorted on `a.dateObj - b.dateObj`, which turns a null into the epoch and
 * floats an unparseable `Fecha` to the top of the table. Sending those to the end instead
 * keeps the readable part of the letter in order. `sort` is stable, so rows that share a
 * date keep the order they were read in.
 */
function porFecha(a: ItemFaltaBase, b: ItemFaltaBase): number {
  if (!a.fechaOrden) return b.fechaOrden ? 1 : 0;
  if (!b.fechaOrden) return -1;
  return a.fechaOrden.getTime() - b.fechaOrden.getTime();
}

/** How the caller wants the period read. Everything here is off by default. */
export interface OpcionesAgrupacion {
  /** Also list people who worked in the period without a single falta. */
  readonly incluirSinFaltas?: boolean;
}

/**
 * One entry per person with at least one falta inside `rango` — plus, when
 * `incluirSinFaltas` is set, one zero-filled entry per person who worked the period clean.
 * Sorted by sector and then by name: the order the screen groups them in and the order the
 * mass document prints.
 *
 * Notificaciones takes the default (only people it has something to write a letter about);
 * Indicador asks for the clean people too, because a dashboard that hides everybody at zero
 * cannot be read as "the sector is fine".
 */
export function agruparFaltasPorPersona(
  registros: readonly RegistroDia[],
  configuracion: ConfiguracionFichadas,
  rango: RangoPeriodo,
  opciones: OpcionesAgrupacion = {},
): readonly NotificacionPersona[] {
  const descansoMax = configuracion.descansoMaxMin ?? DESCANSO_MAX_POR_DEFECTO;
  const incluirSinFaltas = opciones.incluirSinFaltas === true;

  const porDni = new Map<string, Acumulador>();
  for (const r of registros) {
    if (!dentroDelPeriodo(r.fecha, rango)) continue;

    // DELIBERATE DIVERGENCE FROM THE LEGACY, and the reason this test is written the way it
    // is. `groupFaultsByPersonAll` (legacy/app.html ~lines 1288-1298) opened with
    // `if (r.excluded) return; if (r.dayType!=='trabajo') return;` applied to EVERY registro,
    // so it silently threw away real faltas: `dia.ts` (lines 108-120) pushes an `incompleta`
    // falta for the "olvidó fichar" case and still returns `tipoDia: 'ausencia'`, because
    // nobody punched. Under the legacy rule that falta never reached the Indicador, and the
    // same person was reported with one count on the Indicador and another on the
    // Notificaciones screen.
    //
    // Here the `trabajo` / `excluido` test decides ONLY whether a clean person earns a row of
    // zeros. A registro that HAS faltas is processed unconditionally, exactly as it was
    // before this option existed, so the two screens can never disagree about a count.
    if (r.faltas.length === 0 && !(incluirSinFaltas && !r.excluido && r.tipoDia === 'trabajo')) {
      continue;
    }

    let acc = porDni.get(r.dni);
    if (!acc) {
      acc = {
        usuario: r.usuario,
        dni: r.dni,
        sector: r.sector,
        legajo: r.legajo,
        incompleta: [],
        descanso: [],
        tardanza: [],
      };
      porDni.set(r.dni, acc);
    }
    // Identity is the first row seen, except the sector: QUICKPASS leaves it blank on some
    // rows, so the last one that actually says something wins.
    if (r.sector) acc.sector = r.sector;

    for (const falta of r.faltas) {
      const base = {
        fecha: r.fechaStr,
        turnoRaw: r.turnoRaw,
        fechaOrden: r.fecha,
        detalle: falta.detalle,
      };
      switch (falta.tipo) {
        case 'incompleta':
          acc.incompleta.push({
            ...base,
            registradas: r.movimientos.length
              ? r.movimientos.map(fmtReloj).join(' - ')
              : SIN_DATO,
            // Flagged only by the QUICKPASS "Olvidó fichar" note, with a punch count that
            // already looks complete: say so instead of a contradictory "4 de 4".
            cantidad:
              falta.olvidoFichar === true && r.cantidadMovimientos >= r.fichadasRequeridas
                ? 'Olvidó fichar (parte QUICKPASS)'
                : `${r.cantidadMovimientos} de ${r.fichadasRequeridas}`,
          });
          break;
        case 'descanso':
          acc.descanso.push({
            ...base,
            descansoTomado: fmtMinutos(r.descansoReal),
            exceso: fmtMinutos(r.descansoReal - descansoMax),
          });
          break;
        case 'tardanza': {
          // `noUncheckedIndexedAccess`: an empty movimientos array yields undefined here.
          const primera = r.movimientos[0];
          acc.tardanza.push({
            ...base,
            horarioFichado: primera === undefined ? SIN_DATO : fmtReloj(primera),
            minutos: fmtMinutos(r.cantidadTarde),
          });
          break;
        }
      }
    }
  }

  const personas: NotificacionPersona[] = [];
  for (const acc of porDni.values()) {
    const faltasPorTipo: FaltasPorTipo = {
      incompleta: acc.incompleta.sort(porFecha),
      descanso: acc.descanso.sort(porFecha),
      tardanza: acc.tardanza.sort(porFecha),
    };
    // `exactOptionalPropertyTypes`: an empty legajo leaves the key absent rather than
    // setting it to undefined, which is not the same thing to this compiler.
    personas.push(
      acc.legajo
        ? { usuario: acc.usuario, dni: acc.dni, sector: acc.sector, faltasPorTipo, legajo: acc.legajo }
        : { usuario: acc.usuario, dni: acc.dni, sector: acc.sector, faltasPorTipo },
    );
  }

  personas.sort((a, b) => a.sector.localeCompare(b.sector) || a.usuario.localeCompare(b.usuario));
  return personas;
}
