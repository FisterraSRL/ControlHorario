/**
 * The weekly tardanza allowance: the first N `tardanza` faults of each person's
 * Monday–Sunday week are forgiven.
 *
 * It is a post-processing pass over the day records and not a rule of `construirRegistroDia`,
 * because one day cannot know whether it is the first late arrival of its week. It is also
 * not a count: the forgiven fault is REMOVED from `faltas`, so every consumer that reads
 * `faltas` — the per-person grouping, the sidebar counter, the Word, Horas — agrees without
 * learning anything new. The removed fault is kept in `tardanzaPerdonada` so the day can
 * still say it was late.
 *
 * IT MUST RUN OVER THE WHOLE HISTORIAL, never over a period. A period that cut a week in half
 * would otherwise forgive a different tardanza depending on where it started, and the same
 * day would be a fault on one screen and forgiven on another. The week is the calendar week
 * of `RegistroDia.inicioSemana`, the same one the Horas report groups by.
 *
 * Pure: no I/O, no module state, the input is never mutated.
 */

import type { RegistroDia } from './tipos.js';

/**
 * Returns the records in their original order, with a new object only for each day whose
 * tardanza was forgiven. `n <= 0` (or anything that is not a finite number) forgives nothing.
 * A record without a date has no week and is never forgiven.
 */
export function perdonarTardanzas(registros: readonly RegistroDia[], n: number): RegistroDia[] {
  const salida = [...registros];
  const permitidas = Number.isFinite(n) ? Math.floor(n) : 0;
  if (permitidas <= 0) return salida;

  // Index of every day that carries a tardanza, grouped by person-week.
  const porSemana = new Map<string, number[]>();
  registros.forEach((r, i) => {
    if (r.fecha === null || r.inicioSemana === null) return;
    if (!r.faltas.some((f) => f.tipo === 'tardanza')) return;
    const clave = r.dni + '|' + r.inicioSemana;
    const indices = porSemana.get(clave);
    if (indices) indices.push(i);
    else porSemana.set(clave, [i]);
  });

  for (const indices of porSemana.values()) {
    // Chronological, so the input order does not decide which day is forgiven. Equal dates
    // fall back to the raw cell and then to the input position, so the choice is stable.
    indices.sort((a, b) => {
      const ra = registros[a] as RegistroDia;
      const rb = registros[b] as RegistroDia;
      const porFecha = (ra.fecha as Date).getTime() - (rb.fecha as Date).getTime();
      if (porFecha !== 0) return porFecha;
      if (ra.fechaStr !== rb.fechaStr) return ra.fechaStr < rb.fechaStr ? -1 : 1;
      return a - b;
    });
    for (const i of indices.slice(0, permitidas)) {
      const r = registros[i] as RegistroDia;
      const perdonada = r.faltas.find((f) => f.tipo === 'tardanza');
      if (!perdonada) continue;
      salida[i] = {
        ...r,
        faltas: r.faltas.filter((f) => f !== perdonada),
        tardanzaPerdonada: perdonada,
      };
    }
  }

  return salida;
}
