/**
 * Container for the Indicador screen.
 *
 * It owns nothing: no state, no effect, no request, nothing to download. The screen is a
 * pure reading of the period, so this file is only the wiring between the three providers
 * and the two pure functions that turn their data into a table.
 *
 * `incluirSinFaltas` is the one decision here. Notificaciones asks the same grouping for the
 * people it has a letter to write about; a dashboard has to show the clean people too, or an
 * empty sector cannot be told apart from a sector nobody uploaded.
 */

import { useMemo } from 'react';

import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import { agruparFaltasPorPersona } from '../../faltas/agrupacion.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { usePeriodo } from '../../periodo/PeriodoProvider.js';
import { IndicadorScreen } from './IndicadorScreen.js';
import { totalesDelPeriodo } from './indicador.js';

export function IndicadorContainer() {
  const { registros, cargando } = useHistorial();
  const { paraElMotor } = useConfiguracion();
  const { rango } = usePeriodo();

  const personas = useMemo(
    () => agruparFaltasPorPersona(registros, paraElMotor, rango, { incluirSinFaltas: true }),
    [registros, paraElMotor, rango],
  );

  const totales = useMemo(() => totalesDelPeriodo(personas), [personas]);

  return <IndicadorScreen personas={personas} totales={totales} cargando={cargando} />;
}
