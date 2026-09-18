/**
 * Container for Configuración. It reads the configuration and the historial, joins the two
 * (a sector rule and an exclusion are both identifiers with a label that lives elsewhere)
 * and hands plain rows to the screen.
 */

import { useMemo } from 'react';

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
        void crearMotivo(label, worked);
      }}
      onMotivoRetirar={(id) => {
        void retirarMotivo(id);
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
