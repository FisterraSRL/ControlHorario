/**
 * Container for Configuración. It reads the configuration and the historial, joins the two
 * (a sector rule and an exclusion are both identifiers with a label that lives elsewhere)
 * and hands plain rows to the screen.
 */

import { useCallback, useMemo } from 'react';

import { useAusencias } from '../../ausencias/AusenciasProvider.js';
import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import type { ParametrosConfiguracion } from '../../configuracion/RepositorioConfiguracion.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { ConfiguracionScreen } from './ConfiguracionScreen.js';
import {
  filasDeExclusion,
  filasDeSector,
  personasDelHistorial,
  personasExcluibles,
} from './configuracion.js';

export function ConfiguracionContainer() {
  const { registros, sectores: sectoresDelHistorial } = useHistorial();
  const {
    configuracion,
    cargando,
    error,
    guardarParametros,
    guardarReglaSector,
    crearMotivo,
    editarMotivo,
    retirarMotivo,
    agregarExclusion,
    quitarExclusion,
  } = useConfiguracion();

  const { recargar: recargarAusencias } = useAusencias();

  /**
   * Creating or retiring a motivo re-derives the absence registry on the server, because the
   * QUICKPASS note is matched against the labels of the active motivos. Reloading it here is
   * what keeps Ausencias (the persisted registry) and Horas (the engine, which already sees
   * the new list) showing the same motivo for the same day.
   */
  const recargarSiCambio = useCallback(
    async (cambio: boolean) => {
      if (cambio) await recargarAusencias();
    },
    [recargarAusencias],
  );

  const personas = useMemo(() => personasDelHistorial(registros), [registros]);

  const sectores = useMemo(
    () => filasDeSector(configuracion?.reglasSector ?? {}, sectoresDelHistorial),
    [configuracion, sectoresDelHistorial],
  );

  const exclusiones = useMemo(
    () => filasDeExclusion(configuracion?.exclusiones ?? [], personas),
    [configuracion, personas],
  );

  const excluibles = useMemo(
    () => personasExcluibles(personas, configuracion?.exclusiones ?? []),
    [personas, configuracion],
  );

  return (
    <ConfiguracionScreen
      cargando={cargando}
      error={error}
      parametros={configuracion?.parametros ?? null}
      sectores={sectores}
      motivos={configuracion?.motivos ?? []}
      exclusiones={exclusiones}
      excluibles={excluibles}
      onSector={(sector, fichadasRequeridas) => {
        void guardarReglaSector(sector, fichadasRequeridas);
      }}
      onParametro={(campo: keyof ParametrosConfiguracion, valor: number) => {
        void guardarParametros({ [campo]: valor });
      }}
      onMotivoWorked={(id, worked) => {
        void editarMotivo(id, worked);
      }}
      onMotivoNuevo={(label, worked) => {
        void crearMotivo(label, worked).then(recargarSiCambio);
      }}
      onMotivoRetirar={(id) => {
        void retirarMotivo(id).then(recargarSiCambio);
      }}
      onExcluir={(dni) => {
        void agregarExclusion(dni, null);
      }}
      onIncluir={(dni) => {
        void quitarExclusion(dni);
      }}
    />
  );
}
