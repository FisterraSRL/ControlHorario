import { Button } from '../../components/atoms/Button/Button.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { Dropzone } from '../../components/molecules/Dropzone/Dropzone.js';
import { Stat, StatGrid } from '../../components/molecules/Stat/Stat.js';
import { ResumenDeCarga } from './ResumenDeCarga.js';
import type { EstadoImportacion } from './importacion.js';
import type { ResumenCarga } from './resumen.js';
import './carga.css';

export interface CargaScreenProps {
  readonly onArchivo: (archivo: File) => void;
  readonly estado: EstadoImportacion;
  readonly onConfirmar: () => void;
  readonly onCancelar: () => void;
  readonly onRecargar: () => void;
  readonly error: string | null;
  readonly errorHistorial: string | null;
  readonly resumen: ResumenCarga | null;
  readonly cargandoHistorial: boolean;
  readonly diasEnHistorial: number;
}

export function CargaScreen({ onArchivo, estado, onConfirmar, onCancelar, onRecargar,
  error, errorHistorial, resumen, cargandoHistorial, diasEnHistorial }: CargaScreenProps) {
  const guardando = estado.fase === 'guardando';
  const previa = estado.previa;
  return <>
    <Card titulo="Importar planilla de QUICKPASS" bajada="Elegí el Excel de fichadas tal como lo exporta QUICKPASS. Primero vas a revisar su contenido y los cambios previstos. No se guarda nada hasta confirmar.">
      <Dropzone onArchivo={onArchivo} accept=".xlsx,.xls"
        titulo={guardando ? 'Guardando importación…' : estado.fase === 'leyendo' ? 'Leyendo la planilla…' : 'Elegir o cambiar archivo Excel'}
        ayuda={guardando ? 'Esperá a que termine antes de salir' : 'Archivo .xlsx o .xls; también podés arrastrarlo hasta acá'} disabled={guardando} />
      {estado.fase === 'leyendo' && <p role="status">Leyendo el archivo. <Button onClick={onCancelar}>Cancelar</Button></p>}
      {guardando && <p role="status">Guardando los datos confirmados…</p>}
      {error && <div className="carga__error"><Alert tono="error" titulo="Revisá la importación">{error}</Alert></div>}
      {cargandoHistorial && !guardando && <p role="status">Consultando el historial…</p>}
      {(errorHistorial || estado.fase === 'error') && !guardando && <Button onClick={onRecargar} disabled={cargandoHistorial}>Actualizar historial</Button>}
    </Card>
    {previa && <Card titulo="Vista previa: todavía no se guardó" bajada={<><b>{previa.planilla.archivo}</b> · hoja «{previa.planilla.hoja}»</>}>
      <StatGrid>
        <Stat etiqueta="Período del archivo" valor={previa.periodo} />
        <Stat etiqueta="Personas" valor={previa.personas} />
        <Stat etiqueta="Filas leídas" valor={previa.planilla.filas.length} />
        <Stat etiqueta="Días únicos válidos" valor={previa.filas.length} />
      </StatGrid>
      <div className="carga__cambios"><StatGrid>
        <Stat etiqueta="Días nuevos previstos" valor={previa.estimado.nuevas} />
        <Stat etiqueta="Días a reemplazar previstos" valor={previa.estimado.actualizadas} />
        <Stat etiqueta="Sin cambios previstos" valor={previa.estimado.sinCambios} />
        <Stat etiqueta="Filas inválidas" valor={previa.invalidas} />
      </StatGrid></div>
      <p>Estos conteos son estimados según el historial consultado. Pueden cambiar si otra persona importa datos. El resumen final confirma lo guardado.</p>
      <p>Al confirmar se reemplaza la información completa de los días coincidentes por DNI y fecha. Los demás días se conservan.</p>
      {previa.repetidas > 0 && <Alert tono="info" titulo="Filas idénticas repetidas">Se omitirán {previa.repetidas} repeticiones idénticas. Cada día se importará una sola vez.</Alert>}
      {previa.planilla.columnasFaltantes.length > 0 && <Alert tono="aviso" titulo="Columnas ausentes">{previa.planilla.columnasFaltantes.join(', ')}. La información de esas columnas no estará disponible en los días importados.</Alert>}
      {previa.errores.length > 0 && <Alert tono="error" titulo={`Corregí ${previa.errores.length} problemas antes de importar`}>
        <p>No se importará ninguna fila hasta corregir el archivo y volver a seleccionarlo.</p>
        <ul>{previa.errores.slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}</ul>
        {previa.errores.length > 30 && <p>Se muestran los primeros 30 problemas.</p>}
      </Alert>}
      <div className="carga__acciones">
        <Button variante="primary" onClick={onConfirmar} disabled={guardando || cargandoHistorial || !!errorHistorial || previa.errores.length > 0}>Confirmar importación</Button>
        <Button onClick={onCancelar} disabled={guardando}>Cancelar</Button>
      </div>
    </Card>}
    {resumen && !errorHistorial && !cargandoHistorial && <ResumenDeCarga resumen={resumen} />}
    {!resumen && !previa && !cargandoHistorial && !errorHistorial && diasEnHistorial > 0 && <Card titulo="Historial acumulado"><p className="carga__estado">Hay <b>{diasEnHistorial}</b> días de fichadas guardados. Elegir o cancelar un archivo no los modifica.</p></Card>}
  </>;
}
