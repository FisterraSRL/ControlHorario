import { useMemo, useRef, useState } from 'react';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { CargaScreen } from './CargaScreen.js';
import { crearImportacion, estadoInicial } from './importacion.js';
import { resumirCarga } from './resumen.js';

export function CargaContainer() {
  const historial = useHistorial();
  const actual = useRef(historial);
  actual.current = historial;
  const [estado, setEstado] = useState(estadoInicial);
  const [importacion] = useState(() => crearImportacion({
    historial: () => ({ filas: actual.current.filas, disponible: !actual.current.cargando && !actual.current.error }),
    guardar: filas => actual.current.guardar(filas),
    publicar: setEstado,
  }));
  const resumen = useMemo(() => {
    if (!estado.ultima) return null;
    const { planilla, guardado } = estado.ultima;
    return resumirCarga({ archivo: planilla.archivo, hoja: planilla.hoja,
      filasEnArchivo: planilla.filas.length, columnasFaltantes: planilla.columnasFaltantes,
      guardado, registros: historial.registros });
  }, [estado.ultima, historial.registros]);
  return <CargaScreen onArchivo={archivo => { void importacion.seleccionar(archivo); }}
    estado={estado} onConfirmar={() => { void importacion.confirmar(); }}
    onCancelar={() => importacion.cancelar()} onRecargar={historial.recargar}
    error={estado.error ?? historial.error} resumen={resumen}
    cargandoHistorial={historial.cargando} errorHistorial={historial.error}
    diasEnHistorial={historial.registros.length} />;
}
