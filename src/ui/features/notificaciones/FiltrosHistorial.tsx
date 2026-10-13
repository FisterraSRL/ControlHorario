import { useId, useState } from 'react';
import { normalizarFiltros, problemaFiltros, type FiltrosHistorial } from '../../../notificaciones/filtrosHistorial.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Input } from '../../components/atoms/Input/Input.js';
import { Select } from '../../components/atoms/Select/Select.js';

export function FiltrosHistorialForm({ onAplicar, ocupado }: { readonly onAplicar: (f: FiltrosHistorial) => void; readonly ocupado: boolean }) {
  const [busqueda, setBusqueda] = useState(''); const [sector, setSector] = useState('');
  const [desde, setDesde] = useState(''); const [hasta, setHasta] = useState(''); const [marcas, setMarcas] = useState('');
  const [error, setError] = useState<string | null>(null); const errorId = useId();
  const filtros = () => ({ busqueda, sector, desde, hasta, ...(marcas ? { marcas: marcas as 'con' | 'sin' } : {}) });
  return <form className="envios__filtros" aria-label="Filtros del historial" onSubmit={e => {
    e.preventDefault(); if (ocupado) return;
    const f = filtros(); const problema = problemaFiltros(f); setError(problema);
    if (!problema) onAplicar(normalizarFiltros(f));
  }}>
    <p className="envios__ayuda">Busca en todo el historial por el nombre, DNI y sector del documento original. Las fechas corresponden a la fecha del documento y no al período del encabezado. Las marcas no confirman la entrega a la persona.</p>
    <Input etiqueta="Persona o DNI" mostrarEtiqueta valor={busqueda} onCambio={setBusqueda} maxLength={300} />
    <Input etiqueta="Sector del documento" mostrarEtiqueta valor={sector} onCambio={setSector} maxLength={300} />
    <Input etiqueta="Documento desde" mostrarEtiqueta type="date" valor={desde} onCambio={setDesde} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} />
    <Input etiqueta="Documento hasta" mostrarEtiqueta type="date" valor={hasta} onCambio={setHasta} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} />
    <label>Marcas actuales<Select etiqueta="Marcas actuales" valor={marcas} onCambio={setMarcas} opciones={[{ valor:'', label:'Todos los documentos' }, { valor:'con', label:'Con faltas marcadas' }, { valor:'sin', label:'Sin faltas marcadas' }]} /></label>
    <div className="envios__acciones"><Button type="submit" disabled={ocupado}>Aplicar filtros</Button><Button disabled={ocupado} variante="ghost" onClick={() => { setBusqueda(''); setSector(''); setDesde(''); setHasta(''); setMarcas(''); setError(null); onAplicar({}); }}>Limpiar filtros</Button></div>
    {error && <p id={errorId} className="envios__ayuda" role="alert">{error}</p>}
  </form>;
}
