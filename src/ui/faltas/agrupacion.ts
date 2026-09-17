/**
 * The ONE definition of "faltas per person" in the period.
 *
 * Notificaciones needs it to build its Word documents and Indicador will need the same
 * buckets to count them, so it lives here rather than inside either screen: two independent
 * groupings would be two chances for the letter and the dashboard to disagree about how
 * many faltas somebody has.
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

/**
 * One entry per person who has at least one falta inside `rango`, sorted by sector and then
 * by name — the order the screen groups them in and the order the mass document prints.
 */
export function agruparFaltasPorPersona(
  registros: readonly RegistroDia[],
  configuracion: ConfiguracionFichadas,
  rango: RangoPeriodo,
): readonly NotificacionPersona[] {
  const descansoMax = configuracion.descansoMaxMin ?? DESCANSO_MAX_POR_DEFECTO;

  const porDni = new Map<string, Acumulador>();
  for (const r of registros) {
    if (!dentroDelPeriodo(r.fecha, rango)) continue;
    if (r.faltas.length === 0) continue;

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
