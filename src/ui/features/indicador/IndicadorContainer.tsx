import { FiltrosPersonas } from '../../personas/FiltrosPersonas.js';
import { useFiltroPersonas } from '../../personas/filtro.js';
/**
 * Container for the Indicador screen.
 *
 * Filters the current period before deriving row counts and visible totals.
 * NotificadasProvider supplies the generated-document marks.
 *
 * `incluirSinFaltas` is the one decision here. Notificaciones asks the same grouping for the
 * people it has a letter to write about; a dashboard has to show the clean people too, or an
 * empty sector cannot be told apart from a sector nobody uploaded.
 */

import { useMemo } from 'react';

import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import { agruparFaltasPorPersona } from '../../faltas/agrupacion.js';
import { EstadoHistorial } from '../../historial/EstadoHistorial.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { useNotificadas } from '../../notificaciones/NotificadasProvider.js';
import { usePeriodo } from '../../periodo/PeriodoProvider.js';
import { IndicadorScreen } from './IndicadorScreen.js';
import { notificadasDelPeriodo, totalesDelPeriodo } from './indicador.js';

export function IndicadorContainer() {
  const { registros, cargando, error: errorHistorial, recargar } = useHistorial();
  const { paraElMotor } = useConfiguracion();
  const { rango } = usePeriodo();

  const todasLasPersonas = useMemo(
    () => agruparFaltasPorPersona(registros, paraElMotor, rango, { incluirSinFaltas: true }),
    [registros, paraElMotor, rango],
  );

  const filtros = useFiltroPersonas(todasLasPersonas);
  const personas = filtros.personas;

  const totales = useMemo(() => totalesDelPeriodo(personas), [personas]);

  const { notificadas, cargando: cargandoNotificadas, error } = useNotificadas();
  const notificadasPorPersona = useMemo(
    () => notificadasDelPeriodo(personas, notificadas),
    [personas, notificadas],
  );

  if (errorHistorial || cargando) return <EstadoHistorial cargando={cargando} error={errorHistorial} onReintentar={recargar} />;

  return (
    <IndicadorScreen
      filtros={<FiltrosPersonas {...filtros} onCambio={filtros.setFiltro} />}
      sinCoincidencias={filtros.sinCoincidencias}
      personas={personas}
      totales={totales}
      notificadas={notificadasPorPersona}
      cargando={cargando}
      cargandoNotificadas={cargandoNotificadas}
      errorNotificadas={error}
    />
  );
}
