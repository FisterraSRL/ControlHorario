import { describe, expect, it } from 'vitest';

import { DENSIDAD_COMODA } from './densidad.js';
import {
  COLUMNA_RESALTADA,
  META_FALTAS,
  ORDEN_FALTAS,
  SIN_DATO,
  buildTablaDeFaltas,
  seccionesDeFaltas,
  totalDeFaltas,
} from './tablaDeFaltas.js';
import type { ItemDescanso, ItemIncompleta, ItemTardanza } from './tipos.js';
import { DESCANSOS, INCOMPLETAS, TARDANZAS } from './__fixtures__/personas.js';
import { contar, parsearFragmento, textosDe } from './__fixtures__/xml.js';

/** The four column headings, then each row's four cells, as the parser reads them back. */
function celdas(xml: string): string[] {
  return textosDe(xml);
}

describe('META_FALTAS', () => {
  it('carries the printed label, colour and tint of each falta, verbatim from the legacy', () => {
    expect(META_FALTAS).toEqual({
      incompleta: { label: 'Fichadas incompletas', color: 'A66A10', shade: 'FBEBD3' },
      descanso: { label: 'Exceso de descanso', color: '2E6F9E', shade: 'DEEBF5' },
      tardanza: { label: 'Llegadas tarde', color: 'B93A2A', shade: 'FBE1DC' },
    });
  });

  it('covers every falta the engine can derive', () => {
    expect(Object.keys(META_FALTAS).sort()).toEqual([...ORDEN_FALTAS].sort());
  });
});

describe('ORDEN_FALTAS', () => {
  it('leads with fichadas incompletas, which is a business decision, not an accident', () => {
    expect(ORDEN_FALTAS).toEqual(['incompleta', 'descanso', 'tardanza']);
  });
});

describe('totalDeFaltas', () => {
  it('adds every bucket', () => {
    expect(
      totalDeFaltas({ incompleta: INCOMPLETAS, descanso: DESCANSOS, tardanza: TARDANZAS }),
    ).toBe(4);
    expect(totalDeFaltas({ incompleta: [], descanso: [], tardanza: [] })).toBe(0);
  });
});

describe('seccionesDeFaltas', () => {
  it('keeps only the faltas the person actually incurred', () => {
    const secciones = seccionesDeFaltas({
      incompleta: [],
      descanso: DESCANSOS,
      tardanza: TARDANZAS,
    });
    expect(secciones.map((s) => s.tipo)).toEqual(['descanso', 'tardanza']);
  });

  it('returns nothing for somebody clean', () => {
    expect(seccionesDeFaltas({ incompleta: [], descanso: [], tardanza: [] })).toEqual([]);
  });

  it('emits sections in ORDEN_FALTAS order, whatever the buckets look like', () => {
    const secciones = seccionesDeFaltas({
      incompleta: INCOMPLETAS,
      descanso: DESCANSOS,
      tardanza: TARDANZAS,
    });
    expect(secciones.map((s) => s.tipo)).toEqual(ORDEN_FALTAS);
  });

  it('pairs each section with its own rows', () => {
    const secciones = seccionesDeFaltas({
      incompleta: INCOMPLETAS,
      descanso: DESCANSOS,
      tardanza: TARDANZAS,
    });
    expect(secciones.map((s) => s.items.length)).toEqual([2, 1, 1]);
  });
});

describe('buildTablaDeFaltas: incompleta', () => {
  const xml = buildTablaDeFaltas({ tipo: 'incompleta', items: INCOMPLETAS }, DENSIDAD_COMODA);

  it('uses the Fichadas Incompletas headings', () => {
    expect(celdas(xml).slice(0, 4)).toEqual([
      'Fecha',
      'Horario de Turno',
      'Fichadas Registradas',
      'Cantidad',
    ]);
  });

  it('renders one row per falta, oldest first', () => {
    // The fixture is deliberately given 03/08 before 01/08.
    expect(celdas(xml).slice(4)).toEqual([
      '01/08/2026',
      SIN_DATO,
      '—',
      'Olvidó fichar (parte QUICKPASS)',
      '03/08/2026',
      '08:00 - 17:00',
      '08:05 - 12:00 - 17:02',
      '3 de 4',
    ]);
  });

  it('highlights the count column in amber', () => {
    expect(contar(xml, '<w:color w:val="A66A10"/>')).toBe(2);
    expect(contar(xml, 'w:fill="FBEBD3"')).toBe(2);
  });
});

describe('buildTablaDeFaltas: descanso', () => {
  const xml = buildTablaDeFaltas({ tipo: 'descanso', items: DESCANSOS }, DENSIDAD_COMODA);

  it('uses the Exceso de Descanso headings', () => {
    expect(celdas(xml).slice(0, 4)).toEqual([
      'Fecha',
      'Horario de Turno',
      'Descanso Tomado',
      'Minutos de Exceso',
    ]);
  });

  it('renders the break taken and the excess', () => {
    expect(celdas(xml).slice(4)).toEqual(['05/08/2026', '08:00 - 17:00', '1:12', '0:42']);
  });

  it('highlights the excess column in blue', () => {
    expect(contar(xml, '<w:color w:val="2E6F9E"/>')).toBe(1);
    expect(contar(xml, 'w:fill="DEEBF5"')).toBe(1);
  });
});

describe('buildTablaDeFaltas: tardanza', () => {
  const xml = buildTablaDeFaltas({ tipo: 'tardanza', items: TARDANZAS }, DENSIDAD_COMODA);

  it('uses the Llegadas Tarde headings — the reference shape the others were modelled on', () => {
    expect(celdas(xml).slice(0, 4)).toEqual([
      'Fecha',
      'Horario de Turno',
      'Horario Fichado',
      'Minutos de Tardanza',
    ]);
  });

  it('renders the punch and how late it was', () => {
    expect(celdas(xml).slice(4)).toEqual(['07/08/2026', '08:00 - 17:00', '08:23', '0:23']);
  });

  it('highlights the minutes column in red', () => {
    expect(contar(xml, '<w:color w:val="B93A2A"/>')).toBe(1);
    expect(contar(xml, 'w:fill="FBE1DC"')).toBe(1);
  });
});

describe('buildTablaDeFaltas: shared behaviour', () => {
  it('always highlights the last of four columns', () => {
    expect(COLUMNA_RESALTADA).toBe(3);
    for (const xml of [
      buildTablaDeFaltas({ tipo: 'incompleta', items: INCOMPLETAS }, DENSIDAD_COMODA),
      buildTablaDeFaltas({ tipo: 'descanso', items: DESCANSOS }, DENSIDAD_COMODA),
      buildTablaDeFaltas({ tipo: 'tardanza', items: TARDANZAS }, DENSIDAD_COMODA),
    ]) {
      expect(contar(xml, '<w:gridCol')).toBe(4);
      expect(() => parsearFragmento(xml)).not.toThrow();
    }
  });

  it('falls back to the em dash when the turno is empty', () => {
    const sinTurno: ItemTardanza = {
      fecha: '01/01/2026',
      fechaOrden: new Date(Date.UTC(2026, 0, 1)),
      turnoRaw: '',
      horarioFichado: '09:10',
      minutos: '0:10',
    };
    expect(celdas(buildTablaDeFaltas({ tipo: 'tardanza', items: [sinTurno] }, DENSIDAD_COMODA))[5]).toBe(
      SIN_DATO,
    );
    expect(SIN_DATO).toBe('—');
  });

  it('renders the headers alone when there is nothing to report', () => {
    const xml = buildTablaDeFaltas({ tipo: 'descanso', items: [] }, DENSIDAD_COMODA);
    expect(contar(xml, '<w:tr>')).toBe(1);
    expect(celdas(xml)).toHaveLength(4);
  });

  it('does not reorder the caller’s array', () => {
    const original: readonly ItemDescanso[] = [
      {
        fecha: '02/01/2026',
        fechaOrden: new Date(Date.UTC(2026, 0, 2)),
        turnoRaw: 't',
        descansoTomado: '1:00',
        exceso: '0:30',
      },
      {
        fecha: '01/01/2026',
        fechaOrden: new Date(Date.UTC(2026, 0, 1)),
        turnoRaw: 't',
        descansoTomado: '1:00',
        exceso: '0:30',
      },
    ];
    const copia = [...original];
    buildTablaDeFaltas({ tipo: 'descanso', items: original }, DENSIDAD_COMODA);
    expect(original).toEqual(copia);
  });

  it('sorts a row with no parseable date to the very top, as the epoch', () => {
    const items: readonly ItemIncompleta[] = [
      {
        fecha: '10/01/2026',
        fechaOrden: new Date(Date.UTC(2026, 0, 10)),
        turnoRaw: 't',
        registradas: 'a',
        cantidad: '1 de 4',
      },
      {
        fecha: 'ilegible',
        fechaOrden: null,
        turnoRaw: 't',
        registradas: 'b',
        cantidad: '2 de 4',
      },
    ];
    const textos = celdas(buildTablaDeFaltas({ tipo: 'incompleta', items }, DENSIDAD_COMODA));
    expect(textos[4]).toBe('ilegible');
    expect(textos[8]).toBe('10/01/2026');
  });

  it('shrinks the whole table with the density', () => {
    const comoda = buildTablaDeFaltas({ tipo: 'tardanza', items: TARDANZAS }, DENSIDAD_COMODA);
    expect(comoda).toContain('<w:sz w:val="19"/>');
    expect(comoda).toContain('<w:top w:w="50" w:type="dxa"/>');
  });

  it('escapes hostile text coming through a data cell', () => {
    const item: ItemTardanza = {
      fecha: '</w:t></w:r></w:tc><w:tc><w:p><w:r><w:t>inyectado',
      fechaOrden: new Date(Date.UTC(2026, 0, 1)),
      turnoRaw: 'A & B',
      horarioFichado: '<>',
      minutos: '"0:10"',
    };
    const xml = buildTablaDeFaltas({ tipo: 'tardanza', items: [item] }, DENSIDAD_COMODA);
    expect(contar(xml, '<w:tc>')).toBe(8); // 4 headers + 4 cells, no smuggled ninth
    expect(celdas(xml).slice(4)).toEqual([item.fecha, 'A & B', '<>', '"0:10"']);
  });
});
