/** Functional smoke test over Azure SQL using synthetic data that is removed in `finally`. */

import { leerConfiguracion, ErrorConfiguracion } from './config.js';
import { crearPool, enTransaccion } from './db.js';
import { crearRepositorioAzureSql } from './repositorioAzureSql.js';
import { crearRepositorioAusencias } from './repositorioAusencias.js';
import { crearRepositorioConfiguracion } from './repositorioConfiguracion.js';

const DNI = 'CH-SMOKE-20991231';
const FECHA_ISO = '2099-12-31';
const ARCHIVO = '__controlhorario_smoke__.xlsx';
const ACTOR = 'smoke@controlhorario.invalid';

async function main(): Promise<void> {
  const pool = crearPool(leerConfiguracion());
  try {
    await enTransaccion(pool, async (cliente) => {
      await cliente.query('DELETE FROM [controlhorario].[fichadas] WHERE [dni] = $1', [DNI]);
      await cliente.query('DELETE FROM [controlhorario].[cargas] WHERE [archivo] = $1', [ARCHIVO]);
      await cliente.query('DELETE FROM [controlhorario].[auditoria] WHERE [actor] = $1', [ACTOR]);
    });

    const historial = crearRepositorioAzureSql(pool);
    const configuracion = crearRepositorioConfiguracion(pool);
    const ausencias = crearRepositorioAusencias(pool);
    const fila = {
      Sector: 'Prueba técnica',
      Usuario: 'PERSONA SINTETICA',
      DNI,
      Legajo: 'SMOKE',
      Fecha: '31/12/2099',
      Turno: '08:00 - 17:00',
      Movimientos: '',
      'Horas Turno': '9:00',
      Horas: '',
      'Cantidad Tarde': '',
      Partes: '',
    };

    const guardado = await historial.upsert([fila], { archivo: ARCHIVO, subidoPor: ACTOR });
    if (guardado.nuevas !== 1) throw new Error('La carga sintética no insertó una fichada.');

    const filas = await historial.listar();
    const cfg = await configuracion.paraElMotor();
    const sincronizacion = await ausencias.sincronizar(filas, cfg, ACTOR);
    if (sincronizacion.creadas !== 1) throw new Error('La ausencia sintética no fue derivada.');

    const asignada = await ausencias.asignarMotivo(DNI, FECHA_ISO, 4, ACTOR);
    if (asignada?.motivoId !== 4 || asignada.motivoSource !== 'manual') {
      throw new Error('La decisión manual no quedó atribuida correctamente.');
    }

    process.stdout.write(`${JSON.stringify({
      carga: 'ok',
      lecturaHistorial: filas.some((f) => f.DNI === DNI) ? 'ok' : 'falló',
      derivacionAusencia: 'ok',
      decisionManual: 'ok',
    }, null, 2)}\n`);
  } finally {
    try {
      await enTransaccion(pool, async (cliente) => {
        await cliente.query('DELETE FROM [controlhorario].[fichadas] WHERE [dni] = $1', [DNI]);
        await cliente.query('DELETE FROM [controlhorario].[cargas] WHERE [archivo] = $1', [ARCHIVO]);
        await cliente.query('DELETE FROM [controlhorario].[auditoria] WHERE [actor] = $1', [ACTOR]);
      });
    } finally {
      await pool.end();
    }
  }
}

main().catch((e: unknown) => {
  const prefijo = e instanceof ErrorConfiguracion ? 'Configuración inválida' : 'Smoke test fallido';
  process.stderr.write(`${prefijo}: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
