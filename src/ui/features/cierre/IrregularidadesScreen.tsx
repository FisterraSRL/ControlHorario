import { useState } from 'react';

import {
  claveIrregularidad, ESTADOS_IRREGULARIDAD, MAX_NOTA_IRREGULARIDAD,
  type DecisionIrregularidad, type EstadoIrregularidad,
} from '../../../domain/cierre.js';
import type { TipoFalta } from '../../../domain/fichadas/index.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Input } from '../../components/atoms/Input/Input.js';
import { Select } from '../../components/atoms/Select/Select.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import type { FilaIrregularidad } from './cierre.js';

const TIPOS: Readonly<Record<TipoFalta, string>> = {
  incompleta: 'Fichada incompleta',
  tardanza: 'Tardanza',
  descanso: 'Descanso excedido',
};
const ESTADOS: Readonly<Record<EstadoIrregularidad, string>> = {
  justificada: 'Justificada',
  revisada: 'Revisada sin justificación',
};
const OPCIONES = [
  { valor: '', label: 'Pendiente' },
  ...ESTADOS_IRREGULARIDAD.map((valor) => ({ valor, label: ESTADOS[valor] })),
];

function EditorDecision({ fila, ocupado, guardar }: {
  readonly fila: FilaIrregularidad;
  readonly ocupado: boolean;
  readonly guardar: (decision: DecisionIrregularidad | null) => void;
}) {
  const [estado, setEstado] = useState<EstadoIrregularidad | ''>(fila.decision?.estado ?? '');
  const [nota, setNota] = useState(fila.decision?.nota ?? '');
  const notaLimpia = nota.trim();
  const editado = estado !== (fila.decision?.estado ?? '') || (!!estado && notaLimpia !== (fila.decision?.nota ?? ''));
  const referencia = `${TIPOS[fila.tipo]} de ${fila.usuario || fila.dni} el ${fila.fechaVisible}`;

  return (
    <form className="cierre__editor" onSubmit={(evento) => {
      evento.preventDefault();
      if (ocupado || !editado || (estado === 'justificada' && !notaLimpia)) return;
      guardar(estado ? { estado, nota: notaLimpia } : null);
    }}>
      <Select etiqueta={`Estado de ${referencia}`} tamano="sm" opciones={OPCIONES} valor={estado}
        onCambio={(valor) => setEstado(valor as EstadoIrregularidad | '')} disabled={ocupado} />
      {estado && <Input etiqueta={`Motivo de ${referencia}`} valor={nota} onCambio={setNota}
        placeholder={estado === 'justificada' ? 'Ingresá un motivo' : 'Nota opcional'}
        required={estado === 'justificada'} maxLength={MAX_NOTA_IRREGULARIDAD} disabled={ocupado} />}
      <Button tamano="sm" variante="primary" type="submit"
        disabled={ocupado || !editado || (estado === 'justificada' && !notaLimpia)}>
        Guardar revisión
      </Button>
    </form>
  );
}

export function IrregularidadesScreen({ filas, cargando, ocupado, errorLectura, errorGuardado, aviso, reintentar, guardar }: {
  readonly filas: readonly FilaIrregularidad[];
  readonly cargando: boolean;
  readonly ocupado: boolean;
  readonly errorLectura: string | null;
  readonly errorGuardado: string | null;
  readonly aviso: string | null;
  readonly reintentar: () => void;
  readonly guardar: (fila: FilaIrregularidad, decision: DecisionIrregularidad | null) => void;
}) {
  return (
    <Card titulo="Irregularidades">
      {errorLectura && <Alert tono="error" titulo="No se pudieron cargar las revisiones">
        <p>{errorLectura}</p>
        <Button tamano="sm" onClick={reintentar}>Reintentar</Button>
      </Alert>}
      {errorGuardado && <Alert tono="error" titulo="No se pudo guardar la revisión">{errorGuardado}</Alert>}
      {aviso && <Alert tono="ok">{aviso}</Alert>}
      {!errorLectura && <Table etiqueta="Irregularidades del período">
        <thead><tr><th>Persona</th><th>Fecha</th><th>Irregularidad</th><th>Estado guardado</th><th>Revisión</th></tr></thead>
        <tbody>
          {filas.length === 0 && <FilaVacia columnas={5}>
            {cargando ? 'Cargando irregularidades…' : 'No hay irregularidades para esta selección.'}
          </FilaVacia>}
          {filas.map((fila) => <tr key={claveIrregularidad(fila)}>
            <td><strong>{fila.usuario || fila.dni}</strong><br />{fila.sector || 'Sin sector'}</td>
            <td className="tabla__mono">{fila.fechaVisible}</td>
            <td>
              <strong>{TIPOS[fila.tipo]}</strong><br />{fila.detalle}
              {fila.fichadas && <div className="tabla__mono">{fila.fichadas}</div>}
            </td>
            <td><Chip tono={fila.decision ? 'ok' : 'incompleta'}>
              {fila.decision ? ESTADOS[fila.decision.estado] : 'Pendiente'}
            </Chip></td>
            <td>
              <EditorDecision fila={fila} ocupado={ocupado} guardar={(decision) => guardar(fila, decision)} />
            </td>
          </tr>)}
        </tbody>
      </Table>}
    </Card>
  );
}
