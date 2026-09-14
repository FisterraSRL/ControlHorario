/**
 * Container for the Ausencias screen.
 *
 * It owns the filter, which rows are expanded, the attachment list, and every call into a
 * repository. `AusenciasScreen` takes the result as props.
 *
 * THE ATTACHMENT LIST IS HELD HERE and not in a provider: it is the only screen that reads
 * it, and a provider would mean the whole app re-rendering every time somebody attaches a
 * certificate.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Adjunto } from '../../adjuntos/RepositorioAdjuntos.js';
import { useAusencias } from '../../ausencias/AusenciasProvider.js';
import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { ErrorNoAutenticado } from '../../http.js';
import { usePeriodo } from '../../periodo/PeriodoProvider.js';
import { useSesion } from '../../sesion/SesionProvider.js';
import { MOTIVOS_POR_DEFECTO } from '../../../domain/fichadas/index.js';
import { pluralizar } from '../../texto.js';
import { AusenciasScreen } from './AusenciasScreen.js';
import { construirVista, FILTRO_INICIAL, type FiltroAusencias } from './ausencias.js';

/**
 * Hands the browser a file it already has in memory.
 *
 * The bytes arrive through an authenticated `fetch`, so there is no URL to link to and this
 * is the only way to save one. The object URL is revoked immediately: it is a live handle
 * to a medical certificate, and one left dangling keeps the blob alive for the lifetime of
 * the document.
 */
function guardarComo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.rel = 'noopener';
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
  } finally {
    // A tick, so the click has started the download before the handle goes away.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function AusenciasContainer() {
  const { repositorios, expirar } = useSesion();
  const { rango } = usePeriodo();
  const { registros, cargando: cargandoHistorial } = useHistorial();
  const { configuracion } = useConfiguracion();
  const {
    ausencias,
    cargando: cargandoAusencias,
    error: errorAusencias,
    asignarMotivo,
  } = useAusencias();

  const repoAdjuntos = repositorios.adjuntos;

  const [filtro, setFiltro] = useState<FiltroAusencias>(FILTRO_INICIAL);
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(() => new Set());
  const [adjuntos, setAdjuntos] = useState<readonly Adjunto[]>([]);
  const [claveOcupada, setClaveOcupada] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** A 401 anywhere is the session ending, not a message for this screen. */
  const manejar = useCallback(
    (e: unknown, porDefecto: string) => {
      if (e instanceof ErrorNoAutenticado) {
        expirar();
        return;
      }
      setError(e instanceof Error && e.message ? e.message : porDefecto);
    },
    [expirar],
  );

  const recargarAdjuntos = useCallback(async () => {
    if (!repoAdjuntos.disponible) return;
    try {
      setAdjuntos(await repoAdjuntos.listar());
    } catch (e: unknown) {
      manejar(e, 'No se pudieron leer los adjuntos.');
    }
  }, [repoAdjuntos, manejar]);

  useEffect(() => {
    void recargarAdjuntos();
  }, [recargarAdjuntos]);

  const vista = useMemo(
    () => construirVista({ ausencias, registros, adjuntos, rango, filtro }),
    [ausencias, registros, adjuntos, rango, filtro],
  );

  const alternar = useCallback((clave: string) => {
    setAbiertas((previas) => {
      const siguiente = new Set(previas);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
  }, []);

  const cambiarMotivo = useCallback(
    (dni: string, fechaStr: string, motivoId: number | null) => {
      setError(null);
      setAviso(null);
      void (async () => {
        // The provider reports rather than throws, and it puts its own failure on screen.
        // Confirming a change that did not happen is worse than not confirming one.
        const guardado = await asignarMotivo(dni, fechaStr, motivoId);
        if (guardado) {
          setAviso(motivoId === null ? 'Se quitó la clasificación.' : 'Motivo asignado.');
        }
      })();
    },
    [asignarMotivo],
  );

  const subir = useCallback(
    (clave: string, dni: string, fechaStr: string, archivos: readonly File[]) => {
      setError(null);
      setAviso(null);
      setClaveOcupada(clave);
      void (async () => {
        try {
          // Sequentially, not in parallel: the server writes each file and then its row, and
          // three concurrent uploads of 10 MB each over an office uplink is how a request
          // times out halfway.
          for (const archivo of archivos) {
            await repoAdjuntos.subir(dni, fechaStr, archivo);
          }
          await recargarAdjuntos();
          setAviso(
            archivos.length === 1
              ? 'Archivo adjuntado.'
              : `Se adjuntaron ${pluralizar(archivos.length, 'archivo', 'archivos')}.`,
          );
        } catch (e: unknown) {
          // Whatever landed before the failure is real, so the list is re-read either way.
          await recargarAdjuntos();
          manejar(e, 'No se pudo adjuntar el archivo.');
        } finally {
          setClaveOcupada(null);
        }
      })();
    },
    [repoAdjuntos, recargarAdjuntos, manejar],
  );

  const descargar = useCallback(
    (adjunto: Adjunto) => {
      setError(null);
      void (async () => {
        try {
          guardarComo(await repoAdjuntos.descargar(adjunto.id), adjunto.nombre);
        } catch (e: unknown) {
          manejar(e, 'No se pudo descargar el archivo.');
        }
      })();
    },
    [repoAdjuntos, manejar],
  );

  const eliminar = useCallback(
    (clave: string, adjunto: Adjunto) => {
      setError(null);
      setAviso(null);
      setClaveOcupada(clave);
      void (async () => {
        try {
          await repoAdjuntos.eliminar(adjunto.id);
          await recargarAdjuntos();
          setAviso('Se quitó el archivo.');
        } catch (e: unknown) {
          manejar(e, 'No se pudo quitar el archivo.');
        } finally {
          setClaveOcupada(null);
        }
      })();
    },
    [repoAdjuntos, recargarAdjuntos, manejar],
  );

  return (
    <AusenciasScreen
      vista={vista}
      filtro={filtro}
      onFiltro={setFiltro}
      // Before the configuration arrives, the dropdown still has to be usable: the engine's
      // own list is the same nine motivos migration 001 seeds.
      motivos={configuracion?.motivos ?? MOTIVOS_POR_DEFECTO}
      abiertas={abiertas}
      onAlternar={alternar}
      onMotivo={cambiarMotivo}
      adjuntosDisponibles={repoAdjuntos.disponible}
      claveOcupada={claveOcupada}
      onSubir={subir}
      onDescargar={descargar}
      onEliminar={eliminar}
      cargando={cargandoAusencias || cargandoHistorial}
      error={error ?? errorAusencias}
      aviso={aviso}
    />
  );
}
