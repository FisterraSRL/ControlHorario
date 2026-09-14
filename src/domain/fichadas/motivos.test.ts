import { describe, expect, it } from 'vitest';

import {
  ID_OLVIDO_FICHAR,
  ID_RECUPERA_HORAS,
  MOTIVOS_POR_DEFECTO,
  PARTES_MAP,
  clasificarPartes,
  indiceMotivosTrabajados,
} from './motivos.js';

describe('clasificarPartes', () => {
  const casos: ReadonlyArray<readonly [string, string, number | null]> = [
    ['sin parte no hay motivo', '', null],
    ['un parte que no reconoce nadie no inventa un motivo', 'llegó con el auto roto', null],
    ['Ausente sin Aviso', 'Ausente sin Aviso', 1],
    ['Ausente con Aviso', 'ausente con aviso (llamó)', 2],
    ['Suspensión, por el prefijo "suspensi"', 'Suspension disciplinaria', 3],
    ['Enfermedad', 'Licencia enfermedad', 4],
    ['Feriado', 'FERIADO nacional', 5],
    ['Autorizado empresa', 'Autorizado por RRHH', 6],
    ['Autorizado empresa, por "compensa"', 'compensa horas del sábado', 6],
    ['Autorizado empresa, por "trabaja fuera"', 'trabaja fuera de planta', 6],
    ['Vacaciones, por el prefijo "vacacion"', 'Vacaciones', 7],
    ['Olvidó fichar, con acento', 'Olvidó fichar (x2)', ID_OLVIDO_FICHAR],
    ['Olvidó fichar, sin acento', 'olvido fichar', ID_OLVIDO_FICHAR],
    ['Recupera Horas', 'Recupera Horas', ID_RECUPERA_HORAS],
    ['Recupera Horas sin espacio', 'RecuperaHoras', ID_RECUPERA_HORAS],
  ];

  it.each(casos)('%s', (_nombre, parte, esperado) => {
    expect(clasificarPartes(parte)).toBe(esperado);
  });

  it('clasifica "Recupera Horas - Autorizado" como Recupera Horas: el orden del mapa es la regla', () => {
    // Recupera Horas does NOT count as worked; Autorizado empresa does. If the loose
    // autorizado|compensa|trabaja-fuera pattern were tested first, this note would pay
    // hours that were not worked.
    expect(clasificarPartes('Recupera Horas - Autorizado')).toBe(ID_RECUPERA_HORAS);
    expect(clasificarPartes('Autorizado - Recupera Horas')).toBe(ID_RECUPERA_HORAS);
  });

  it('keeps Recupera Horas ahead of the loose autorizado pattern in PARTES_MAP', () => {
    const iRecupera = PARTES_MAP.findIndex(([, id]) => id === ID_RECUPERA_HORAS);
    const iAutorizado = PARTES_MAP.findIndex(([, id]) => id === 6);
    expect(iRecupera).toBeGreaterThanOrEqual(0);
    expect(iRecupera).toBeLessThan(iAutorizado);
  });
});

describe('MOTIVOS_POR_DEFECTO', () => {
  it('marks as worked only the motivos that still pay the shift', () => {
    const trabajados = MOTIVOS_POR_DEFECTO.filter((m) => m.worked).map((m) => m.id);
    expect(trabajados).toEqual([4, 5, 6, 7, ID_OLVIDO_FICHAR]);
  });

  it('counts Recupera Horas as NOT worked — the hours are being paid back, not worked', () => {
    expect(MOTIVOS_POR_DEFECTO.find((m) => m.id === ID_RECUPERA_HORAS)?.worked).toBe(false);
  });

  it('counts Olvidó fichar as worked — the person was on shift, they just did not register it', () => {
    expect(MOTIVOS_POR_DEFECTO.find((m) => m.id === ID_OLVIDO_FICHAR)?.worked).toBe(true);
  });

  it('has no duplicate ids', () => {
    const ids = MOTIVOS_POR_DEFECTO.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('indiceMotivosTrabajados', () => {
  it('lets a caller override the closed list', () => {
    const idx = indiceMotivosTrabajados([{ id: 1, label: 'Ausente sin Aviso', worked: true }]);
    expect(idx.get(1)).toBe(true);
    expect(idx.get(4)).toBeUndefined();
  });
});
