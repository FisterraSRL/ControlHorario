import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { generarWordMasivo, MIME_DOCX, META_FALTAS, type DocumentoGenerado } from '../../../notificaciones/index.js';
import { clavesSnapshot, idMarca, personaDe, type DocumentoPendiente, type HistorialEnvios, type MarcaVersionada, type PedidoEmision } from '../../../notificaciones/envios.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { Table, FilaVacia } from '../../components/molecules/Table/Table.js';
import { ErrorNoAutenticado } from '../../http.js';
import { useNotificadas } from '../../notificaciones/NotificadasProvider.js';
import { useSesion } from '../../sesion/SesionProvider.js';
import './envios.css';

function descargar(doc: DocumentoGenerado): void {
  const url = URL.createObjectURL(new Blob([doc.bytes as Uint8Array<ArrayBuffer>], { type: MIME_DOCX }));
  try {
    const a = document.createElement('a'); a.href = url; a.download = doc.nombreArchivo; document.body.append(a); a.click(); a.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export function generarDocumentos(docs: readonly DocumentoPendiente[], fecha: string): DocumentoGenerado {
  const documento = generarWordMasivo(docs.map(d => personaDe(d.snapshot)), { hoy: new Date(`${fecha}T12:00:00`) });
  if (!documento) throw new Error('No hay faltas para generar documentos.');
  return documento;
}
function fechaHoy(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function momento(iso: string): string { return new Date(iso).toLocaleString('es-AR'); }
function DetalleDocumento({ doc }: { readonly doc: DocumentoPendiente }) {
  return <details><summary>{new Set(clavesSnapshot(doc.snapshot).map(c => c.fechaIso)).size} días · {clavesSnapshot(doc.snapshot).length} faltas</summary>
    <ul className="envios__detalle">{Object.entries(doc.snapshot.faltasPorTipo).flatMap(([tipo, filas]) => filas.map(f => <li key={`${tipo}|${f.fechaOrden}`}><strong>{f.fecha}</strong> · {META_FALTAS[tipo as keyof typeof META_FALTAS].label} · {f.detalle ?? f.turnoRaw}</li>))}</ul>
  </details>;
}

/** Persistence and download stay behind the repository port; the two panels ignore period. */
export function EnviosContainer({ historial = false }: { readonly historial?: boolean }) {
  const { repositorios, expirar } = useSesion();
  const { recargar: recargarMarcas } = useNotificadas();
  const repo = repositorios.envios;
  const [pendientes, setPendientes] = useState<readonly DocumentoPendiente[]>([]);
  const [registro, setRegistro] = useState<HistorialEnvios>({ documentos: [], anteriores: [], hayMas: false });
  const [pagina, setPagina] = useState(0);
  const [revision, setRevision] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<readonly MarcaVersionada[] | null>(null);
  const enVuelo = useRef(false);
  const pedido = useRef<PedidoEmision | null>(null);
  const fallo = useCallback((e: unknown) => {
    if (e instanceof ErrorNoAutenticado) expirar();
    else setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
  }, [expirar]);
  useEffect(() => {
    let vigente = true;
    setCargando(true); setError(null);
    const cargar = async () => {
      try {
        if (historial) { const datos = await repo.historial(pagina); if (vigente) setRegistro(datos); }
        else { const datos = await repo.pendientes(); if (vigente) setPendientes(datos); }
      } catch (e) { if (vigente) fallo(e); }
      finally { if (vigente) setCargando(false); }
    };
    void cargar();
    return () => { vigente = false; };
  }, [repo, historial, pagina, revision, fallo]);
  const accion = async (fn: () => Promise<void>) => {
    if (enVuelo.current) return;
    enVuelo.current = true; setOcupado(true); setError(null); setAviso(null);
    try { await fn(); }
    catch (e) { fallo(e); }
    finally { enVuelo.current = false; setOcupado(false); }
  };
  const emitir = () => accion(async () => {
    const ids = pendientes.map(d => d.id).sort();
    if (!pedido.current || JSON.stringify([...pedido.current.documentos].sort()) !== JSON.stringify(ids)) pedido.current = { id: crypto.randomUUID(), documentos: ids, fechaDocumento: fechaHoy() };
    // Build before committing so generation failure cannot mark any fault as notified.
    const doc = generarDocumentos(pendientes, pedido.current.fechaDocumento);
    try { await repo.emitir(pedido.current); }
    catch (e) { setAviso('Si la emisión se guardó pero la respuesta no llegó, los documentos estarán en el historial. Actualizá el panel antes de volver a generar.'); throw e; }
    pedido.current = null;
    recargarMarcas(); setPendientes([]); setRevision(v => v + 1);
    descargar(doc);
    setAviso('Documentos generados. Podés volver a descargarlos desde el historial sin cambiar las marcas.');
  });
  const descartar = (id: string) => accion(async () => { await repo.descartar(id); pedido.current = null; setRevision(v => v + 1); setAviso('Documento descartado del envío. Sus faltas no se marcaron como notificadas.'); });
  const quitar = () => accion(async () => {
    if (!confirmar) return;
    await repo.quitar(confirmar); setConfirmar(null); recargarMarcas(); setRevision(v => v + 1);
    setAviso('Se quitaron las marcas vigentes de la selección. El documento sigue en el historial. Las notificaciones posteriores se conservan.');
  });
  const bloqueado = ocupado || cargando;
  return <section className="envios">
    <div className="envios__acciones"><Link to={historial ? '/envios' : '/historial-notificaciones'}>{historial ? 'Ir al panel de envío' : 'Ver historial'}</Link><Button disabled={bloqueado} onClick={() => setRevision(v => v + 1)}>Actualizar</Button></div>
    {error && <Alert tono="error">{error}</Alert>}
    {aviso && <Alert tono="info">{aviso}</Alert>}
    {confirmar && <Alert tono="aviso"><p>¿Quitar «Notificado» a {confirmar.length} falta(s)? Los documentos permanecerán en el historial.</p><div className="envios__acciones"><Button disabled={bloqueado} onClick={() => void quitar()}>Quitar Notificado</Button><Button disabled={ocupado} onClick={() => setConfirmar(null)}>Cancelar</Button></div></Alert>}
    {!historial ? <Card titulo="Panel de envío" bajada="Revisá los documentos preparados y descartá los que no quieras emitir. Se conserva el contenido elegido al agregarlos, aunque cambien los datos o la configuración. Generar todo descarga un Word con todas las cartas y marca sus faltas como notificadas." acciones={<Button variante="primary" disabled={bloqueado || !!error || !pendientes.length} onClick={() => void emitir()}>Generar documentos ({pendientes.length})</Button>}>
      <Table etiqueta="Documentos pendientes"><thead><tr><th>Persona</th><th>Sector</th><th>Días incluidos</th><th>Preparado</th><th>Acción</th></tr></thead><tbody>
        {!pendientes.length && <FilaVacia columnas={5}>{cargando ? 'Cargando…' : 'No hay documentos pendientes. Agregalos desde Notificaciones.'}</FilaVacia>}
        {pendientes.map(d => <tr key={d.id}><td>{d.snapshot.usuario}<small className="envios__sub">{d.snapshot.dni}</small></td><td>{d.snapshot.sector}</td><td><DetalleDocumento doc={d} /></td><td>{momento(d.creadoAt)}</td><td><Button variante="ghost" disabled={bloqueado} onClick={() => void descartar(d.id)}>Descartar</Button></td></tr>)}
      </tbody></Table>
    </Card> : <>
      <Card titulo="Historial de notificaciones" bajada="Las descargas del historial conservan el contenido y la fecha de emisión. Quitar Notificado permite volver a preparar una falta y conserva el documento original.">
        <Table etiqueta="Documentos emitidos"><thead><tr><th>Persona</th><th>Emisión</th><th>Días incluidos</th><th>Estado actual</th><th>Acciones</th></tr></thead><tbody>
          {!registro.documentos.length && <FilaVacia columnas={5}>{cargando ? 'Cargando…' : 'No hay documentos emitidos en esta página.'}</FilaVacia>}
          {registro.documentos.map(d => <tr key={d.id}><td>{d.snapshot.usuario}<small className="envios__sub">{d.snapshot.dni}</small></td><td>{momento(d.emitidoAt)}</td><td><DetalleDocumento doc={d} /></td><td>{d.activas.length} de {clavesSnapshot(d.snapshot).length} marcas vigentes<details><summary>Ver faltas</summary><ul className="envios__detalle">{clavesSnapshot(d.snapshot).map(c => {
            const activa = d.activas.find(m => idMarca(m) === idMarca(c));
            return <li key={idMarca(c)}>{c.fechaIso} · {META_FALTAS[c.tipo].label} {activa ? <Button tamano="sm" variante="ghost" disabled={bloqueado} onClick={() => setConfirmar([activa])}>Quitar Notificado</Button> : '· Sin marca de esta emisión'}</li>;
          })}</ul></details></td><td><div className="envios__acciones"><Button disabled={bloqueado} onClick={() => void accion(async () => descargar(generarDocumentos([d], d.fechaDocumento)))}>Descargar Word</Button><Button disabled={bloqueado || !d.activas.length} onClick={() => setConfirmar(d.activas)}>Quitar Notificado del documento</Button></div></td></tr>)}
        </tbody></Table>
      </Card>
      {!!registro.anteriores.length && <Card titulo="Notificaciones anteriores" bajada="Marcas registradas antes del panel. No hay documento guardado para volver a descargar."><Table etiqueta="Marcas anteriores"><thead><tr><th>DNI</th><th>Fecha</th><th>Falta</th><th>Notificada</th><th>Acción</th></tr></thead><tbody>{registro.anteriores.map(m => <tr key={m.version}><td>{m.dni}</td><td>{m.fechaIso}</td><td>{META_FALTAS[m.tipo].label}</td><td>{momento(m.notificadoAt)}</td><td><Button disabled={bloqueado} onClick={() => setConfirmar([m])}>Quitar Notificado</Button></td></tr>)}</tbody></Table></Card>}
      <div className="envios__acciones"><Button disabled={bloqueado || pagina === 0} onClick={() => { setConfirmar(null); setPagina(p => p - 1); }}>Anterior</Button><span>Página {pagina + 1}</span><Button disabled={bloqueado || !registro.hayMas} onClick={() => { setConfirmar(null); setPagina(p => p + 1); }}>Siguiente</Button></div>
    </>}
  </section>;
}
