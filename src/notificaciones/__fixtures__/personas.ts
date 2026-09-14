/**
 * Fictional people for the tests.
 *
 * No real employee data, ever: the names below are the Spanish placeholder names (Fulano,
 * Mengana, Zutano), the CUILs are structurally shaped but obviously fake, and the sectors
 * are the ones the fichadas engine already ships as defaults. Anything that looks like a
 * person here is not one.
 *
 * These are also the exact inputs the legacy golden fixture was generated from — see
 * `golden.test.ts`. Change one and that test will tell you.
 */

import type {
  ItemDescanso,
  ItemIncompleta,
  ItemTardanza,
  NotificacionPersona,
} from '../tipos.js';

/** The date every deterministic test dates its letters with. */
export const HOY_FIJO = new Date(Date.UTC(2026, 8, 14, 15, 30, 0));

const utc = (iso: string): Date => new Date(iso);

export const INCOMPLETAS: readonly ItemIncompleta[] = [
  {
    fecha: '03/08/2026',
    detalle: 'x',
    fechaOrden: utc('2026-08-03T00:00:00Z'),
    turnoRaw: '08:00 - 17:00',
    registradas: '08:05 - 12:00 - 17:02',
    cantidad: '3 de 4',
  },
  {
    // Deliberately out of chronological order and with no turno, so the table has to sort
    // it back and fall through to the placeholder.
    fecha: '01/08/2026',
    detalle: 'x',
    fechaOrden: utc('2026-08-01T00:00:00Z'),
    turnoRaw: '',
    registradas: '—',
    cantidad: 'Olvidó fichar (parte QUICKPASS)',
  },
];

export const DESCANSOS: readonly ItemDescanso[] = [
  {
    fecha: '05/08/2026',
    detalle: 'x',
    fechaOrden: utc('2026-08-05T00:00:00Z'),
    turnoRaw: '08:00 - 17:00',
    descansoTomado: '1:12',
    exceso: '0:42',
  },
];

export const TARDANZAS: readonly ItemTardanza[] = [
  {
    fecha: '07/08/2026',
    detalle: 'x',
    fechaOrden: utc('2026-08-07T00:00:00Z'),
    turnoRaw: '08:00 - 17:00',
    horarioFichado: '08:23',
    minutos: '0:23',
  },
];

/** Four faltas across all three types: the comfortable density, every section present. */
export const PERSONA_MIXTA: NotificacionPersona = {
  usuario: 'Fulano De Tal',
  dni: '20-00000000-1',
  sector: 'Reparto',
  legajo: 'L-0001',
  faltasPorTipo: { incompleta: INCOMPLETAS, descanso: DESCANSOS, tardanza: TARDANZAS },
};

/**
 * Every character that can break OOXML, in the three fields that carry data the employee
 * themselves can influence. This is the case that must come out as inert text.
 */
export const PERSONA_INYECCION: NotificacionPersona = {
  usuario: 'Mengana <w:t>INYECTADA</w:t> & "Comillas" \'Simples\'',
  dni: '27-00000000-2 <script>',
  sector: 'Cocina & Depósito',
  legajo: 'L-0002',
  faltasPorTipo: {
    incompleta: [],
    descanso: [],
    tardanza: [
      {
        fecha: '09/08/2026',
        detalle: 'x',
        fechaOrden: utc('2026-08-09T00:00:00Z'),
        turnoRaw: '06:00 - 14:00',
        horarioFichado: '06:31',
        minutos: '0:31',
      },
    ],
  },
};

/** Somebody with `n` tardanzas and nothing else, for crossing the density tiers. */
export function personaDensa(n: number): NotificacionPersona {
  const items: ItemTardanza[] = [];
  for (let i = 0; i < n; i++) {
    const dia = (i % 28) + 1;
    items.push({
      fecha: `${String(dia).padStart(2, '0')}/08/2026`,
      detalle: 'x',
      fechaOrden: new Date(Date.UTC(2026, 7, dia)),
      turnoRaw: '08:00 - 17:00',
      horarioFichado: '08:15',
      minutos: '0:15',
    });
  }
  return {
    usuario: 'Zutano Ficticio',
    dni: '23-00000000-9',
    sector: 'Administración',
    legajo: 'L-0003',
    faltasPorTipo: { incompleta: [], descanso: [], tardanza: items },
  };
}

/** Somebody clean. There is nothing to notify, so no page should be produced. */
export const PERSONA_SIN_FALTAS: NotificacionPersona = {
  usuario: 'Nadie',
  dni: '0',
  sector: 'X',
  faltasPorTipo: { incompleta: [], descanso: [], tardanza: [] },
};
