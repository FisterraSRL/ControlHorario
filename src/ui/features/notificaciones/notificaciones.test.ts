import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { construirRegistroDia } from '../../../domain/fichadas/index.js';
import { generarWordMasivo, type NotificacionPersona } from '../../../notificaciones/index.js';
import { agruparFaltasPorPersona } from '../../faltas/agrupacion.js';
import { clavesNotificadas, separarPorDia, type ClaveNotificada } from '../../faltas/porDia.js';
import {
  alternarDiaSeleccionado,
  alternarPersonaSeleccionada,
  entregarRegistrado,
  etiquetaNotificacion,
  personasSeleccionadas,
  seleccionVisible,
  type SeleccionDias,
} from './notificaciones.js';

const CLAVES: readonly ClaveNotificada[] = [{ dni: '1', fechaIso: '2026-09-15', tipo: 'tardanza' }];

describe('entrega de un Word', () => {
  it('registra antes de descargar', async () => {
    const orden: string[] = [];
    const resultado = await entregarRegistrado(
      CLAVES,
      (claves) => {
        orden.push(`registrar ${claves.length}`);
        return Promise.resolve(true);
      },
      () => orden.push('descargar'),
    );
    expect(resultado).toBe('entregado');
    expect(orden).toEqual(['registrar 1', 'descargar']);
  });

  it('no descarga nada cuando el registro falla', async () => {
    let descargas = 0;
    const resultado = await entregarRegistrado(CLAVES, () => Promise.resolve(false), () => {
      descargas += 1;
    });
    expect(resultado).toBe('no_registrado');
    expect(descargas).toBe(0);
  });

  it('sin claves que registrar descarga sin llamar al servidor', async () => {
    let registros = 0;
    let descargas = 0;
    const resultado = await entregarRegistrado(
      [],
      () => {
        registros += 1;
        return Promise.resolve(true);
      },
      () => {
        descargas += 1;
      },
    );
    expect([resultado, registros, descargas]).toEqual(['entregado', 0, 1]);
  });
});

describe('estado de notificación de un día', () => {
  it('dice «Notificada» con todas, «N de M» con algunas y nada sin ninguna', () => {
    expect(etiquetaNotificacion({ notificadas: 2, total: 2 })).toBe('Notificada');
    expect(etiquetaNotificacion({ notificadas: 1, total: 2 })).toBe('1 de 2 notificadas');
    expect(etiquetaNotificacion({ notificadas: 0, total: 2 })).toBeNull();
    expect(etiquetaNotificacion({ notificadas: 0, total: 0 })).toBeNull();
  });
});

const REGISTROS = ['15/09/2026', '16/09/2026', '17/09/2026', '21/09/2026'].map((Fecha) =>
  construirRegistroDia({
    Sector: 'Pruebas', Usuario: 'Persona Prueba', DNI: 'TEST-001', Legajo: 'TEST-1', Fecha,
    Movimientos: '08:20 - 12:00 - 13:00', Turno: '08:00 - 17:00',
    'Horas Turno': '9:00', Horas: '4:00', 'Cantidad Tarde': '0:20', Partes: '',
  }),
);

function enPeriodo(desde = '2026-09-14', hasta = '2026-09-20') {
  return agruparFaltasPorPersona(REGISTROS, {}, {
    desde: new Date(`${desde}T00:00:00Z`), hasta: new Date(`${hasta}T00:00:00Z`),
  });
}

function diasDe(personas: readonly NotificacionPersona[]) {
  return new Map(personas.map((persona) => [persona.dni, separarPorDia(persona)]));
}

describe('day selection for notifications', () => {
  const personas = enPeriodo();
  const dias = diasDe(personas);
  const dni = 'TEST-001';

  it('selects nonconsecutive dates and records exactly the faults printed in the Word', async () => {
    let seleccion: SeleccionDias = new Map();
    seleccion = alternarDiaSeleccionado(seleccion, dias, dni, '15/09/2026');
    seleccion = alternarDiaSeleccionado(seleccion, dias, dni, '17/09/2026');
    const elegidas = personasSeleccionadas(personas, seleccion);
    const doc = generarWordMasivo(elegidas, { hoy: new Date('2026-10-05T00:00:00Z') });
    if (!doc) throw new Error('Expected a selected-days document');
    const xmlBytes = unzipSync(doc.bytes)['word/document.xml'];
    if (!xmlBytes) throw new Error('Expected the Word document part');
    const xml = strFromU8(xmlBytes);
    expect(xml).toContain('15/09/2026');
    expect(xml).toContain('17/09/2026');
    expect(xml).not.toContain('16/09/2026');
    expect(xml).not.toContain('21/09/2026');
    expect(elegidas).toHaveLength(1);
    expect(elegidas[0]).toMatchObject({ dni, usuario: 'Persona Prueba', sector: 'Pruebas', legajo: 'TEST-1' });
    expect(elegidas[0]?.faltasPorTipo.incompleta[0]).toBe(personas[0]?.faltasPorTipo.incompleta[0]);

    const orden: string[] = [];
    let registradas: readonly ClaveNotificada[] = [];
    await entregarRegistrado(elegidas.flatMap(clavesNotificadas), (claves) => {
      orden.push('registrar');
      registradas = claves;
      return Promise.resolve(true);
    }, () => orden.push('descargar'));
    expect(orden).toEqual(['registrar', 'descargar']);
    expect(registradas).toEqual([
      { dni, fechaIso: '2026-09-15', tipo: 'incompleta' },
      { dni, fechaIso: '2026-09-15', tipo: 'descanso' },
      { dni, fechaIso: '2026-09-15', tipo: 'tardanza' },
      { dni, fechaIso: '2026-09-17', tipo: 'incompleta' },
      { dni, fechaIso: '2026-09-17', tipo: 'descanso' },
      { dni, fechaIso: '2026-09-17', tipo: 'tardanza' },
    ]);
  });

  it('selects every visible date from a partial person, then deselects that whole person', () => {
    const parcial = alternarDiaSeleccionado(new Map(), dias, dni, '16/09/2026');
    const completa = alternarPersonaSeleccionada(parcial, dias, dni);
    expect([...(completa.get(dni) ?? [])]).toEqual(['15/09/2026', '16/09/2026', '17/09/2026']);
    expect([...(parcial.get(dni) ?? [])]).toEqual(['16/09/2026']);
    expect(alternarPersonaSeleccionada(completa, dias, dni).size).toBe(0);
  });

  it('can uncheck one date from a fully selected person', () => {
    const completa = alternarPersonaSeleccionada(new Map(), dias, dni);
    const parcial = alternarDiaSeleccionado(completa, dias, dni, '16/09/2026');
    expect([...(parcial.get(dni) ?? [])]).toEqual(['15/09/2026', '17/09/2026']);
    expect(completa.get(dni)?.size).toBe(3);
  });

  it('removes the person when the last selected date is unchecked', () => {
    const una = alternarDiaSeleccionado(new Map(), dias, dni, '16/09/2026');
    const vacia = alternarDiaSeleccionado(una, dias, dni, '16/09/2026');
    expect(vacia.size).toBe(0);
    expect(generarWordMasivo(personasSeleccionadas(personas, vacia))).toBeNull();
  });

  it('keeps the same date independent across people and preserves document order', () => {
    const primera = personas[0];
    if (!primera) throw new Error('Expected the fixture person');
    const segunda = { ...primera, dni: 'TEST-002', usuario: 'Otra Persona Prueba' };
    const ambas = [primera, segunda];
    const diasAmbas = diasDe(ambas);
    let seleccion = alternarDiaSeleccionado(new Map(), diasAmbas, segunda.dni, '15/09/2026');
    seleccion = alternarDiaSeleccionado(seleccion, diasAmbas, primera.dni, '17/09/2026');
    const elegidas = personasSeleccionadas(ambas, seleccion);
    expect(elegidas.map((p) => p.dni)).toEqual([dni, 'TEST-002']);
    expect(elegidas.map((p) => separarPorDia(p).map((dia) => dia.fecha)))
      .toEqual([['17/09/2026'], ['15/09/2026']]);
    expect(alternarPersonaSeleccionada(seleccion, diasAmbas, dni).get('TEST-002'))
      .toEqual(new Set(['15/09/2026']));
  });

  it('does not select the same person automatically in a different period', () => {
    const anterior = alternarPersonaSeleccionada(new Map(), dias, dni);
    const nuevasPersonas = enPeriodo('2026-09-21', '2026-09-27');
    expect(seleccionVisible(anterior, diasDe(nuevasPersonas)).size).toBe(0);
    expect(personasSeleccionadas(nuevasPersonas, anterior)).toEqual([]);
  });

  it('keeps only overlapping dates without selecting newly visible dates', () => {
    const anterior = alternarPersonaSeleccionada(new Map(), dias, dni);
    const nuevasPersonas = enPeriodo('2026-09-17', '2026-09-21');
    const visible = seleccionVisible(anterior, diasDe(nuevasPersonas));
    expect(visible).toEqual(new Map([[dni, new Set(['17/09/2026'])]]));
    expect(personasSeleccionadas(nuevasPersonas, visible).flatMap(clavesNotificadas)
      .every((clave) => clave.fechaIso === '2026-09-17')).toBe(true);
  });

  it('drops stale dates on the next toggle and ignores dates or people outside the period', () => {
    const anterior = alternarPersonaSeleccionada(new Map(), dias, dni);
    const nuevosDias = diasDe(enPeriodo('2026-09-21', '2026-09-27'));
    const siguiente = alternarDiaSeleccionado(anterior, nuevosDias, dni, '21/09/2026');
    expect(siguiente).toEqual(new Map([[dni, new Set(['21/09/2026'])]]));
    expect(alternarDiaSeleccionado(siguiente, nuevosDias, dni, '15/09/2026')).toEqual(siguiente);
    expect(alternarPersonaSeleccionada(siguiente, nuevosDias, 'TEST-UNKNOWN')).toEqual(siguiente);
    expect(seleccionVisible(siguiente, new Map()).size).toBe(0);
  });
});
