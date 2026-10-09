/**
 * Container for Horas trabajadas. It owns which weeks are open and the confirmation after a
 * motivo write; `HorasScreen` takes both as props.
 *
 * THE OPEN SET IS RAW and the screen never sees it: what it renders is `abiertasVisibles`, the
 * raw set intersected with the weeks of the current period, and every toggle starts from that
 * derived set. A period change therefore needs no effect to clear anything.
 *
 * THE MOTIVO WRITE IS NOT OURS: it is `useAusencias().asignarMotivo`, the same one Ausencias
 * calls. HistorialProvider re-derives every day from the registry it updates, so the week's
 * hours and its pending count follow without this screen recalculating anything.
 */
import { useCallback, useMemo, useState } from 'react';
import { MOTIVOS_POR_DEFECTO } from '../../../domain/fichadas/index.js';
import { useAusencias } from '../../ausencias/AusenciasProvider.js';
import { avisoMotivo } from '../../ausencias/opcionesMotivo.js';
import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import { EstadoHistorial } from '../../historial/EstadoHistorial.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { usePeriodo } from '../../periodo/PeriodoProvider.js';
import { abiertasVisibles, alternarSemana, avisoSemanasParciales, construirReporteHoras, csvDeHoras, desplegarTodas, todasAbiertas } from './horas.js';
import { HorasScreen } from './HorasScreen.js';

function descargarCsv(contenido: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  try {
    const enlace = document.createElement('a'); enlace.href = url;
    enlace.download = `horas_trabajadas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(enlace); enlace.click(); enlace.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

export function HorasContainer() {
  const { registros, cargando, error: errorHistorial, recargar } = useHistorial();
  const { paraElMotor } = useConfiguracion();
  const { periodo, rango } = usePeriodo();
  const { asignarMotivo, error } = useAusencias();
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(() => new Set());
  const [aviso, setAviso] = useState<string | null>(null);
  const semanas = useMemo(() => construirReporteHoras(registros, paraElMotor, rango), [registros, paraElMotor, rango]);
  const visibles = useMemo(() => abiertasVisibles(abiertas, semanas), [abiertas, semanas]);

  const cambiarMotivo = useCallback((dni: string, fechaStr: string, motivoId: number | null) => {
    setAviso(null);
    void (async () => {
      // The provider reports rather than throws and puts its own failure on screen (`error`),
      // so a confirmation only follows a write that actually happened.
      if (await asignarMotivo(dni, fechaStr, motivoId)) setAviso(avisoMotivo(motivoId));
    })();
  }, [asignarMotivo]);

  if (errorHistorial || cargando) return <EstadoHistorial cargando={cargando} error={errorHistorial} onReintentar={recargar} />;

  // Before the configuration arrives the dropdown still has to be usable, as in Ausencias.
  return <HorasScreen semanas={semanas} motivos={paraElMotor.motivos ?? MOTIVOS_POR_DEFECTO} cargando={cargando}
    abiertas={visibles} todasAbiertas={todasAbiertas(visibles, semanas)}
    onAlternar={(clave) => setAbiertas(alternarSemana(visibles, clave))}
    onAlternarTodas={(abrir) => setAbiertas(desplegarTodas(semanas, abrir))}
    onMotivo={cambiarMotivo} error={error} aviso={aviso} semanasParciales={avisoSemanasParciales(periodo)}
    onExportar={() => descargarCsv(csvDeHoras(semanas))} />;
}
