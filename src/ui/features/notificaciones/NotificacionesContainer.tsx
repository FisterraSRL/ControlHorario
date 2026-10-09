import { useCallback, useMemo, useRef, useState } from 'react';

import type { NotificacionPersona } from '../../../notificaciones/index.js';
import { snapshotDe } from '../../../notificaciones/envios.js';
import { useSesion } from '../../sesion/SesionProvider.js';
import { ErrorNoAutenticado } from '../../http.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Link } from 'react-router-dom';
import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import { agruparFaltasPorPersona } from '../../faltas/agrupacion.js';
import { separarPorDia } from '../../faltas/porDia.js';
import { EstadoHistorial } from '../../historial/EstadoHistorial.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { useNotificadas } from '../../notificaciones/NotificadasProvider.js';
import { usePeriodo } from '../../periodo/PeriodoProvider.js';
import { NotificacionesScreen } from './NotificacionesScreen.js';
import {
  alternarDiaSeleccionado,
  alternarPersonaSeleccionada,
  personasSeleccionadas,
  seleccionVisible,
  type SeleccionDias,
} from './notificaciones.js';

function soloVisibles(
  marcados: ReadonlySet<string>,
  personas: readonly NotificacionPersona[],
): ReadonlySet<string> {
  return new Set(personas.filter((p) => marcados.has(p.dni)).map((p) => p.dni));
}

export function NotificacionesContainer() {
  const { registros, cargando, error: errorHistorial, recargar } = useHistorial();
  const { paraElMotor } = useConfiguracion();
  const { rango } = usePeriodo();

  const personas = useMemo(
    () => agruparFaltasPorPersona(registros, paraElMotor, rango),
    [registros, paraElMotor, rango],
  );

  // All current days are needed for selection, including when a person's detail is closed.
  const dias = useMemo(
    () => new Map(personas.map((p) => [p.dni, separarPorDia(p)])),
    [personas],
  );
  const [seleccionadas, setSeleccionadas] = useState<SeleccionDias>(() => new Map());
  const vigentes = useMemo(() => seleccionVisible(seleccionadas, dias), [dias, seleccionadas]);

  // Raw, like Horas: the screen only ever sees `abiertas`, and every toggle starts from that
  // derived set, so a period change needs no effect to close anything.
  const [abiertasCrudas, setAbiertas] = useState<ReadonlySet<string>>(() => new Set());
  const abiertas = useMemo(() => soloVisibles(abiertasCrudas, personas), [abiertasCrudas, personas]);

  const alternarDetalle = useCallback(
    (dni: string) => {
      const siguientes = new Set(abiertas);
      if (siguientes.has(dni)) siguientes.delete(dni);
      else siguientes.add(dni);
      setAbiertas(siguientes);
    },
    [abiertas],
  );

  const alternar = useCallback(
    (dni: string) => setSeleccionadas((previas) => alternarPersonaSeleccionada(previas, dias, dni)),
    [dias],
  );

  const alternarDia = useCallback(
    (dni: string, fecha: string) =>
      setSeleccionadas((previas) => alternarDiaSeleccionado(previas, dias, dni, fecha)),
    [dias],
  );

  const alternarTodas = useCallback(
    (marcado: boolean) =>
      setSeleccionadas(
        marcado
          ? new Map([...dias].map(([dni, porDia]) => [dni, new Set(porDia.map((dia) => dia.fecha))]))
          : new Map(),
      ),
    [dias],
  );

  const { notificadas, error: errorLectura } = useNotificadas();
  const { repositorios, expirar } = useSesion();
  const [preparadas, setPreparadas] = useState(0);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);
  // One queue operation at a time; prevent a second click before buttons re-render.
  // The ref closes the gap before the disabled buttons re-render; the state disables them.
  const [registrando, setRegistrando] = useState(false);
  const enVuelo = useRef(false);

  const preparar = useCallback(async (elegidas: readonly NotificacionPersona[]) => {
    if (enVuelo.current || !elegidas.length) return;
    enVuelo.current = true;
    setErrorRegistro(null);
    setPreparadas(0);
    setRegistrando(true);
    try {
      await repositorios.envios.encolar(elegidas.map(persona => ({ id: crypto.randomUUID(), snapshot: snapshotDe(persona) })));
      setPreparadas(elegidas.length);
      setSeleccionadas(new Map());
    } catch (e) {
      if (e instanceof ErrorNoAutenticado) expirar();
      else setErrorRegistro(e instanceof Error ? e.message : 'No se pudieron agregar los documentos al panel.');
    } finally { enVuelo.current = false; setRegistrando(false); }
  }, [repositorios.envios, expirar]);
  const generarPersona = useCallback(
    (dni: string) => {
      void preparar(personasSeleccionadas(personas, vigentes, dni));
    },
    [personas, vigentes, preparar],
  );

  // Prepare exactly the selected day from the existing grouping.
  const generarDia = useCallback(
    (dni: string, fecha: string) => {
      const persona = personas.find((p) => p.dni === dni);
      if (!persona) return;
      const delDia = separarPorDia(persona).find((d) => d.fecha === fecha);
      if (!delDia) return;
      void preparar([delDia.persona]);
    },
    [personas, preparar],
  );

  const generarSeleccionadas = useCallback(() => {
    const elegidas = personasSeleccionadas(personas, vigentes);
    void preparar(elegidas);
  }, [personas, vigentes, preparar]);

  if (errorHistorial || cargando) return <EstadoHistorial cargando={cargando} error={errorHistorial} onReintentar={recargar} />;

  return (
    <>
      {preparadas > 0 && <Alert tono="ok">{preparadas} documento(s) preparados. <Link to="/envios">Ver documentos preparados</Link></Alert>}
    <NotificacionesScreen
      personas={personas}
      seleccionadas={vigentes}
      abiertas={abiertas}
      dias={dias}
      notificadas={notificadas}
      cargando={cargando}
      registrando={registrando}
      error={errorRegistro ?? (errorLectura ? `No se pudo leer qué faltas tienen documento generado: ${errorLectura}` : null)}
      onAlternar={alternar}
      onAlternarDia={alternarDia}
      onAlternarTodas={alternarTodas}
      onAlternarDetalle={alternarDetalle}
      onGenerarPersona={generarPersona}
      onGenerarDia={generarDia}
      onGenerarSeleccionadas={generarSeleccionadas}
    />
    </>
  );
}
