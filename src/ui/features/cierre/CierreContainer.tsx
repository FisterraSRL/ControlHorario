import { useEffect, useMemo, useRef, useState } from 'react';

import {
  claveIrregularidad, esDiaCorte, type DecisionIrregularidad, type RevisionIrregularidad,
} from '../../../domain/cierre.js';
import { fmtFechaAR } from '../../../domain/fichadas/index.js';
import { registrosDelPeriodo } from '../../app/contadores.js';
import { useAusencias } from '../../ausencias/AusenciasProvider.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Checkbox } from '../../components/atoms/Checkbox/Checkbox.js';
import { Input } from '../../components/atoms/Input/Input.js';
import { Select } from '../../components/atoms/Select/Select.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Calendario } from '../../components/molecules/Calendario/Calendario.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import { EstadoHistorial } from '../../historial/EstadoHistorial.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { ErrorNoAutenticado } from '../../http.js';
import { etiquetaRango, hoyUTC, type RangoPeriodo } from '../../periodo/periodo.js';
import { useSesion } from '../../sesion/SesionProvider.js';
import { pluralizar } from '../../texto.js';
import { AusenciasContainer } from '../ausencias/AusenciasContainer.js';
import { construirVista, FILTRO_INICIAL, type FiltroAusencias } from '../ausencias/ausencias.js';
import {
  construirIrregularidades, mesLiquidacionValido, rangoDeLiquidacion,
  ultimaFechaCargada, type FilaIrregularidad,
} from './cierre.js';
import { IrregularidadesScreen } from './IrregularidadesScreen.js';
import './cierre.css';

function mensaje(error: unknown, predeterminado: string): string {
  return error instanceof Error && error.message ? error.message : predeterminado;
}

export function CierreContainer() {
  const { repositorios, sesion, expirar } = useSesion();
  const repo = repositorios.cierre;
  const puedeConfigurar = !repositorios.conServidor || sesion?.operador.rol === 'admin';
  const [corte, setCorte] = useState<number | null>(null);
  const [borradorCorte, setBorradorCorte] = useState('');
  const [mes, setMes] = useState(() => hoyUTC().toISOString().slice(0, 7));
  const [libre, setLibre] = useState<RangoPeriodo | null>(null);
  const [calendario, setCalendario] = useState(false);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const [errorCorte, setErrorCorte] = useState<string | null>(null);
  const [guardandoCorte, setGuardandoCorte] = useState(false);
  const [guardandoRevision, setGuardandoRevision] = useState(false);
  const [reintento, setReintento] = useState(0);
  const botonCalendario = useRef<HTMLButtonElement>(null);
  const [filtro, setFiltro] = useState<FiltroAusencias>(FILTRO_INICIAL);

  useEffect(() => {
    let vigente = true;
    void repo.leerCorte().then((dia) => {
      if (!vigente) return;
      setCorte(dia);
      setBorradorCorte(String(dia));
    }).catch((error: unknown) => {
      if (!vigente) return;
      if (error instanceof ErrorNoAutenticado) expirar();
      else setErrorLectura(mensaje(error, 'No se pudo leer el corte mensual.'));
    });
    return () => { vigente = false; };
  }, [repo, expirar, reintento]);

  const rango = useMemo(
    () => libre ?? (corte !== null && mesLiquidacionValido(mes) ? rangoDeLiquidacion(mes, corte) : null),
    [corte, libre, mes],
  );
  const nuevoCorte = Number(borradorCorte);
  const corteAplicable = esDiaCorte(nuevoCorte) && nuevoCorte !== corte;

  async function guardarCorte() {
    if (!puedeConfigurar || !corteAplicable || guardandoCorte || guardandoRevision) return;
    setGuardandoCorte(true);
    setErrorCorte(null);
    try {
      await repo.guardarCorte(nuevoCorte);
      setCorte(nuevoCorte);
    } catch (error: unknown) {
      if (error instanceof ErrorNoAutenticado) expirar();
      else setErrorCorte(mensaje(error, 'No se pudo guardar el corte mensual.'));
    } finally {
      setGuardandoCorte(false);
    }
  }

  function moverMes(desplazamiento: number) {
    const origen = mesLiquidacionValido(mes) ? mes : hoyUTC().toISOString().slice(0, 7);
    const anio = Number(origen.slice(0, 4));
    const mesActual = Number(origen.slice(5, 7));
    const destino = new Date(Date.UTC(anio, mesActual - 1 + desplazamiento, 1)).toISOString().slice(0, 7);
    if (mesLiquidacionValido(destino)) setMes(destino);
    setLibre(null);
    setCalendario(false);
  }

  function cerrarCalendario() {
    setCalendario(false);
    botonCalendario.current?.focus();
  }

  if (corte === null) return (
    <Card titulo="Período de liquidación">
      {errorLectura ? <Alert tono="error" titulo="No se pudo abrir el cierre">
        <p>{errorLectura}</p>
        <Button onClick={() => { setErrorLectura(null); setReintento((valor) => valor + 1); }}>Reintentar</Button>
      </Alert> : <p role="status">Cargando corte mensual…</p>}
    </Card>
  );

  return <>
    <Card titulo="Período de liquidación">
      <fieldset className="cierre__periodo" disabled={guardandoRevision || guardandoCorte} aria-label="Selección de período">
        <div className="cierre__controles">
          <Button onClick={() => moverMes(-1)} aria-label="Liquidación anterior">‹</Button>
          <Input etiqueta="Mes de liquidación" mostrarEtiqueta type="month" valor={mes}
            min="1000-01" max="9999-12" placeholder="AAAA-MM"
            onCambio={(valor) => { setMes(valor); setLibre(null); setCalendario(false); }} />
          <Button onClick={() => moverMes(1)} aria-label="Liquidación siguiente">›</Button>
          <button ref={botonCalendario} type="button" className="btn btn--neutral btn--md"
            aria-expanded={calendario} onClick={() => setCalendario(!calendario)}>
            Elegir rango libre
          </button>
          {libre && <Button variante="ghost" onClick={() => { setLibre(null); setCalendario(false); }}>
            Volver al corte mensual
          </Button>}
        </div>
        <div className="cierre__resumen" role="status">
          {rango && <strong>{etiquetaRango(rango)}</strong>}
          <span>{libre ? 'Rango libre' : `Corte mensual el día ${corte}`}</span>
        </div>
        {calendario && <div className="cierre__fecha" onKeyDown={(evento) => {
          if (evento.key === 'Escape') cerrarCalendario();
        }}>
          <Calendario
            {...(rango ?? { desde: hoyUTC(), hasta: hoyUTC() })}
            hoy={hoyUTC()}
            onElegir={(desde, hasta) => { setLibre({ desde, hasta }); cerrarCalendario(); }}
          />
        </div>}
      </fieldset>
      {puedeConfigurar && <form className="cierre__corte" onSubmit={(evento) => {
        evento.preventDefault();
        void guardarCorte();
      }}>
        <Input etiqueta="Día de corte" mostrarEtiqueta type="number" min={1} max={31} step={1}
          required valor={borradorCorte} onCambio={setBorradorCorte} disabled={guardandoCorte || guardandoRevision} />
        <Button type="submit" disabled={guardandoCorte || guardandoRevision || !corteAplicable}>
          {guardandoCorte ? 'Guardando…' : 'Guardar día de corte'}
        </Button>
      </form>}
      {errorCorte && <Alert tono="error" titulo="No se pudo guardar el corte">{errorCorte}</Alert>}
      {!rango && !calendario && <Alert tono="aviso">Elegí el mes de liquidación o las fechas del rango libre.</Alert>}
    </Card>
    {rango && <RevisionDelPeriodo key={`${rango.desde.getTime()}|${rango.hasta.getTime()}`}
      rango={rango} filtro={filtro} cambiarFiltro={setFiltro}
      ocupado={guardandoRevision || guardandoCorte} cambiarGuardando={setGuardandoRevision} />}
  </>;
}

function RevisionDelPeriodo({ rango, filtro, cambiarFiltro, ocupado, cambiarGuardando }: {
  readonly rango: RangoPeriodo;
  readonly filtro: FiltroAusencias;
  readonly cambiarFiltro: (filtro: FiltroAusencias) => void;
  readonly ocupado: boolean;
  readonly cambiarGuardando: (guardando: boolean) => void;
}) {
  const { repositorios, expirar } = useSesion();
  const repo = repositorios.cierre;
  const historial = useHistorial();
  const ausencias = useAusencias();
  const configuracion = useConfiguracion();
  const [revisiones, setRevisiones] = useState<readonly RevisionIrregularidad[] | null>(null);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const guardando = useRef(false);
  const [reintento, setReintento] = useState(0);
  const desde = rango.desde.toISOString().slice(0, 10);
  const hasta = rango.hasta.toISOString().slice(0, 10);

  useEffect(() => {
    let vigente = true;
    void repo.listar(desde, hasta).then((datos) => {
      if (vigente) setRevisiones(datos);
    }).catch((error: unknown) => {
      if (!vigente) return;
      if (error instanceof ErrorNoAutenticado) expirar();
      else setErrorLectura(mensaje(error, 'No se pudieron leer las revisiones.'));
    });
    return () => { vigente = false; };
  }, [repo, desde, hasta, expirar, reintento]);

  const dias = useMemo(() => registrosDelPeriodo(historial.registros, rango), [historial.registros, rango]);
  const seleccion = useMemo(() => dias.filter(({ sector, dni }) =>
    (!filtro.sector || sector === filtro.sector) && (!filtro.dni || dni === filtro.dni)), [dias, filtro.sector, filtro.dni]);
  const ultimaFecha = useMemo(() => ultimaFechaCargada(dias), [dias]);
  const sectores = useMemo(() => [...new Set(dias.map((dia) => dia.sector).filter(Boolean))].sort(), [dias]);
  const personas = useMemo(() => [...new Map(dias.map((dia) => [dia.dni, dia.usuario || dia.dni]))
    .entries()].filter(([dni]) => dni).sort((a, b) => a[1].localeCompare(b[1], 'es')), [dias]);
  const pendientesAusencia = useMemo(() => construirVista({
    ausencias: ausencias.ausencias,
    registros: dias,
    adjuntos: [],
    rango,
    filtro,
  }).pendientes, [ausencias.ausencias, dias, rango, filtro]);
  const irregularidades = useMemo(
    () => revisiones ? construirIrregularidades(seleccion, revisiones) : [],
    [revisiones, seleccion],
  );
  const pendientesIrregularidad = irregularidades.filter((fila) => !fila.decision).length;
  const filtrosActivos = !!(filtro.sector || filtro.dni);

  async function guardar(fila: FilaIrregularidad, decision: DecisionIrregularidad | null) {
    if (guardando.current || ocupado) return;
    guardando.current = true;
    cambiarGuardando(true);
    setErrorGuardado(null);
    setAviso(null);
    const clave = { dni: fila.dni, fecha: fila.fecha, tipo: fila.tipo };
    try {
      await repo.decidir(clave, decision);
      const id = claveIrregularidad(clave);
      setRevisiones((anteriores) => [
        ...(anteriores ?? []).filter((revision) => claveIrregularidad(revision) !== id),
        ...(decision ? [{ ...clave, ...decision }] : []),
      ]);
      setAviso(decision ? 'Revisión guardada.' : 'La irregularidad volvió a quedar pendiente.');
    } catch (error: unknown) {
      if (error instanceof ErrorNoAutenticado) expirar();
      else setErrorGuardado(mensaje(error, 'No se pudo guardar la revisión.'));
    } finally {
      guardando.current = false;
      cambiarGuardando(false);
    }
  }

  if (historial.error || historial.cargando) return (
    <EstadoHistorial cargando={historial.cargando} error={historial.error} onReintentar={historial.recargar} />
  );
  if (configuracion.error) return <Alert tono="error" titulo="No se pudo cargar la configuración">
    {configuracion.error} Recargá la página para reintentar.
  </Alert>;
  if (configuracion.cargando || ausencias.cargando) return <p role="status">Cargando novedades…</p>;

  return <>
    <Card titulo="Novedades del período">
      <div className="cierre__controles">
        <Select etiqueta="Filtrar por sector" valor={filtro.sector} onCambio={(sector) => cambiarFiltro({ ...filtro, sector })}
          opciones={[
            { valor: '', label: 'Todos los sectores' },
            ...sectores.map((sector) => ({ valor: sector, label: sector })),
            ...(filtro.sector && !sectores.includes(filtro.sector) ? [{ valor: filtro.sector, label: filtro.sector }] : []),
          ]} />
        <Select etiqueta="Filtrar por persona" valor={filtro.dni} onCambio={(dni) => cambiarFiltro({ ...filtro, dni })}
          opciones={[
            { valor: '', label: 'Todas las personas' },
            ...personas.map(([dni, nombre]) => ({ valor: dni, label: `${nombre} — ${dni}` })),
            ...(filtro.dni && !personas.some(([dni]) => dni === filtro.dni) ? [{ valor: filtro.dni, label: filtro.dni }] : []),
          ]} />
        <Checkbox marcado={filtro.soloPendientes}
          onCambio={(soloPendientes) => cambiarFiltro({ ...filtro, soloPendientes })}>
          Mostrar solo pendientes
        </Checkbox>
        {filtrosActivos && <Button variante="ghost" onClick={() => cambiarFiltro({ ...filtro, dni: '', sector: '' })}>
          Limpiar filtros
        </Button>}
      </div>
      {ultimaFecha
        ? <p>Última fecha con fichadas cargadas en el período: <strong>{fmtFechaAR(ultimaFecha)}</strong>.</p>
        : <p>No hay fichadas cargadas en el período.</p>}
      {!ausencias.error && revisiones && <div className="cierre__resumen" role="status">
        <strong>{pluralizar(pendientesAusencia + pendientesIrregularidad, 'pendiente', 'pendientes')}{filtrosActivos ? ' en la selección' : ''}</strong>
        <span>{pluralizar(pendientesAusencia, 'ausencia', 'ausencias')} sin clasificar</span>
        <span>{pluralizar(pendientesIrregularidad, 'irregularidad', 'irregularidades')} sin revisar</span>
      </div>}
    </Card>
    <AusenciasContainer revision={{ rango, filtro }} />
    <IrregularidadesScreen
      filas={filtro.soloPendientes ? irregularidades.filter((fila) => !fila.decision) : irregularidades}
      cargando={revisiones === null}
      ocupado={ocupado}
      errorLectura={errorLectura}
      errorGuardado={errorGuardado}
      aviso={aviso}
      reintentar={() => { setErrorLectura(null); setReintento((valor) => valor + 1); }}
      guardar={(fila, decision) => { void guardar(fila, decision); }}
    />
  </>;
}
