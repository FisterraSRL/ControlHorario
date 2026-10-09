import { Button } from '../components/atoms/Button/Button.js';
import { Input } from '../components/atoms/Input/Input.js';
import { Select } from '../components/atoms/Select/Select.js';
import { FILTRO_PERSONAS_INICIAL, type FiltroPersonas } from './filtro.js';
import './filtrosPersonas.css';

interface Props {
  readonly filtro: FiltroPersonas;
  readonly sectores: readonly { valor: string; label: string }[];
  readonly cantidad: number;
  readonly total: number;
  readonly onCambio: (filtro: FiltroPersonas) => void;
}

export function FiltrosPersonas({ filtro, sectores, cantidad, total, onCambio }: Props) {
  return <div className="filtros-personas" role="search" aria-label="Filtrar personas">
    <Input etiqueta="Buscar por nombre o DNI" mostrarEtiqueta type="search" valor={filtro.busqueda}
      onCambio={busqueda => onCambio({ ...filtro, busqueda })} />
    <Select etiqueta="Filtrar por sector" tamano="sm" valor={filtro.sector}
      opciones={[{ valor: '', label: 'Todos los sectores' }, ...sectores, ...(filtro.sector && !sectores.some(s => s.valor === filtro.sector) ? [{ valor: filtro.sector, label: `${JSON.parse(filtro.sector) || 'Sin sector'} (sin datos en este período)` }] : [])]}
      onCambio={sector => onCambio({ ...filtro, sector })} />
    <Button variante="ghost" onClick={() => onCambio(FILTRO_PERSONAS_INICIAL)} disabled={!filtro.busqueda && !filtro.sector}>Limpiar filtros</Button>
    <span role="status">Mostrando {cantidad} de {total} personas del período</span>
  </div>;
}
