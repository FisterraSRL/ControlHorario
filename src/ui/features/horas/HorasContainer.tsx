import { useMemo, useState } from 'react';
import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { usePeriodo } from '../../periodo/PeriodoProvider.js';
import { construirReporteHoras, csvDeHoras } from './horas.js';
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
  const { registros, cargando } = useHistorial();
  const { paraElMotor } = useConfiguracion();
  const { rango } = usePeriodo();
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(() => new Set());
  const semanas = useMemo(() => construirReporteHoras(registros, paraElMotor, rango), [registros, paraElMotor, rango]);
  return <HorasScreen semanas={semanas} motivos={paraElMotor.motivos ?? []} cargando={cargando} abiertas={abiertas}
    onAlternar={(clave) => setAbiertas((previas) => { const siguientes = new Set(previas); if (siguientes.has(clave)) siguientes.delete(clave); else siguientes.add(clave); return siguientes; })}
    onExportar={() => descargarCsv(csvDeHoras(semanas))} />;
}
