/**
 * Container for Cargar datos. The whole upload pipeline lives here:
 *
 *   file  ->  leerPlanilla (xlsx)  ->  guardar (RepositorioFichadas port)
 *         ->  construirRegistroDia over the accumulated historial (in HistorialProvider)
 *         ->  resumirCarga  ->  props for CargaScreen
 *
 * The summary is derived rather than captured: `guardar` updates the provider, the provider
 * re-derives every `RegistroDia`, and the summary is a `useMemo` over those new records. If
 * it were computed inside the upload handler it would read the pre-upload records — the
 * closure captured before the write — and report the historial one upload behind.
 */

import { useCallback, useMemo, useState } from 'react';

import { useHistorial } from '../../historial/HistorialProvider.js';
import type { ResultadoGuardado } from '../../historial/RepositorioFichadas.js';
import { CargaScreen } from './CargaScreen.js';
import { leerPlanilla } from './planilla.js';
import type { PlanillaLeida } from './planilla.js';
import { resumirCarga } from './resumen.js';

interface UltimaCarga {
  readonly planilla: PlanillaLeida;
  readonly guardado: ResultadoGuardado;
}

/**
 * Every failure below is shown on screen. Nothing here logs to the console and continues:
 * an operator who uploaded the wrong file has to be told, and they are not reading devtools.
 */
function mensajeDeError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Ocurrió un error inesperado al procesar el archivo.';
}

export function CargaContainer() {
  const { registros, guardar, cargando, error: errorHistorial } = useHistorial();

  const [procesando, setProcesando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [ultimaCarga, setUltimaCarga] = useState<UltimaCarga | null>(null);

  const manejarArchivo = useCallback(
    async (archivo: File) => {
      setProcesando(true);
      setErrorCarga(null);
      setUltimaCarga(null);
      try {
        const planilla = await leerPlanilla(archivo);
        const guardado = await guardar(planilla.filas);
        setUltimaCarga({ planilla, guardado });
      } catch (e: unknown) {
        setErrorCarga(mensajeDeError(e));
      } finally {
        setProcesando(false);
      }
    },
    [guardar],
  );

  const resumen = useMemo(() => {
    if (!ultimaCarga) return null;
    const { planilla, guardado } = ultimaCarga;
    return resumirCarga({
      archivo: planilla.archivo,
      hoja: planilla.hoja,
      filasEnArchivo: planilla.filas.length,
      columnasFaltantes: planilla.columnasFaltantes,
      guardado,
      registros,
    });
  }, [ultimaCarga, registros]);

  return (
    <CargaScreen
      onArchivo={(archivo) => {
        void manejarArchivo(archivo);
      }}
      procesando={procesando}
      error={errorCarga ?? errorHistorial}
      resumen={resumen}
      cargandoHistorial={cargando}
      diasEnHistorial={registros.length}
    />
  );
}
