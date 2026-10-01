import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { FilaQuickpass } from '../domain/fichadas/tipos.js';
import { crearPoolFalso } from './pruebas/dobles.js';
import { crearRepositorioAusencias } from './repositorioAusencias.js';
import { crearRepositorioConfiguracion } from './repositorioConfiguracion.js';
import type { AlcanceSectores } from './sectores.js';
import { resincronizarAusencias } from './sincronizacionAusencias.js';

/** A day nobody punched, whose note names a motivo that only exists in Configuración. */
const FILA: FilaQuickpass = {
  Sector: 'Cocina',
  Usuario: 'PEREZ JUAN',
  DNI: '11000001',
  Legajo: '145',
  Fecha: '05/01/2026',
  Turno: '08:00 - 17:00',
  Movimientos: '',
  'Horas Turno': '9:00',
  Horas: '0:00',
  'Cantidad Tarde': '',
  Partes: 'Tramite medico por la tarde',
};

const MOTIVOS_ACTIVOS = [
  { id: 1, label: 'Ausente sin Aviso', worked: false },
  { id: 10, label: 'Trámite médico', worked: true },
];

/** Records every line logged, so a test can prove what never reaches the log. */
function logRegistrador(): { readonly log: FastifyBaseLogger; readonly lineas: unknown[][] } {
  const lineas: unknown[][] = [];
  const registrar = (...args: unknown[]) => {
    lineas.push(args);
  };
  const log = { info: registrar, error: registrar, warn: registrar } as unknown as FastifyBaseLogger;
  return { log, lineas };
}

function poolConMotivos(merge: { creadas: number } | Error = { creadas: 1 }) {
  return crearPoolFalso((texto) => {
    if (texto.includes('FROM [controlhorario].[motivos]')) return { rows: MOTIVOS_ACTIVOS };
    if (texto.includes('MERGE [controlhorario].[ausencias]')) {
      return merge instanceof Error
        ? merge
        : { rows: [{ creadas: merge.creadas, refrescadas: 0, podadas: 0 }] };
    }
    return undefined;
  });
}

describe('re-derivación del registro de ausencias', () => {
  it('deriva con los motivos activos: la nota que nombra un motivo creado lo toma como partes', async () => {
    const pool = poolConMotivos();
    const alcances: AlcanceSectores[] = [];
    const { log } = logRegistrador();

    await resincronizarAusencias(
      {
        fichadas: {
          listar: (alcance) => {
            alcances.push(alcance);
            return Promise.resolve([FILA]);
          },
        },
        ausencias: crearRepositorioAusencias(pool),
        configuracion: crearRepositorioConfiguracion(pool),
      },
      'rrhh@ejemplo.test',
      log,
    );

    // Only the active motivos are read: a retired one never reaches the matcher.
    const lecturaMotivos = pool.textos().find((t) => t.includes('FROM [controlhorario].[motivos]'));
    expect(lecturaMotivos).toContain('[activo] = 1');
    // The whole company, never a sector-shaped view of it.
    expect(alcances).toEqual([null]);

    const merge = pool.llamadas.find((l) => l.texto.includes('MERGE [controlhorario].[ausencias]'));
    expect(merge?.enTransaccion).toBe(true);
    expect(JSON.parse(String(merge?.valores[0]))).toEqual([
      { dni: '11000001', fechaIso: '2026-01-05', motivoId: 10, motivoSource: 'partes' },
    ]);
  });

  it('una falla queda en el log y no se propaga, sin la nota ni el DNI', async () => {
    const pool = poolConMotivos(new Error('se cayó la conexión'));
    const { log, lineas } = logRegistrador();

    await expect(
      resincronizarAusencias(
        {
          fichadas: { listar: () => Promise.resolve([FILA]) },
          ausencias: crearRepositorioAusencias(pool),
          configuracion: crearRepositorioConfiguracion(pool),
        },
        'rrhh@ejemplo.test',
        log,
      ),
    ).resolves.toBeUndefined();

    expect(pool.cierres).toEqual(['rollback']);
    expect(lineas).toHaveLength(1);
    const escrito = JSON.stringify(lineas);
    expect(escrito).not.toContain('11000001');
    expect(escrito).not.toContain('Tramite');
  });
});
