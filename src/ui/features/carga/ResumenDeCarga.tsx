import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { Stat, StatGrid } from '../../components/molecules/Stat/Stat.js';
import { pluralizar } from '../../texto.js';
import { etiquetaRangoHistorial } from './resumen.js';
import type { ResumenCarga } from './resumen.js';

/**
 * Presentational: props in, markup out. No domain import, no repository, no file reading.
 *
 * The four headline figures are the legacy ones and describe the WHOLE historial after the
 * upload. The line above them describes the file that was just read, and the warnings below
 * describe anything the file did that the operator should know about.
 */
export function ResumenDeCarga({ resumen }: { readonly resumen: ResumenCarga }) {
  const { guardado } = resumen;
  const huboCambios = guardado.nuevas > 0 || guardado.actualizadas > 0;

  return (
    <Card
      titulo="Resumen de la carga"
      bajada={
        <>
          <b>{resumen.archivo}</b>
          {resumen.hoja && <> · hoja «{resumen.hoja}»</>} ·{' '}
          {pluralizar(resumen.filasEnArchivo, 'fila', 'filas')} en este archivo
        </>
      }
    >
      <StatGrid>
        <Stat etiqueta="Personas" valor={resumen.personas} />
        <Stat etiqueta="Sectores" valor={resumen.sectores} />
        <Stat etiqueta="Días en el historial" valor={resumen.diasEnHistorial} />
        <Stat etiqueta="Rango total" valor={etiquetaRangoHistorial(resumen)} />
      </StatGrid>

      <div className="carga__cambios">
        <StatGrid>
          <Stat etiqueta="Días nuevos" valor={guardado.nuevas} />
          <Stat etiqueta="Días actualizados" valor={guardado.actualizadas} />
          <Stat etiqueta="Sin cambios" valor={guardado.sinCambios} />
        </StatGrid>
      </div>

      <div className="carga__avisos">
        {!huboCambios && (
          <Alert tono="info" titulo="El historial no cambió">
            Todas las filas de este archivo ya estaban cargadas, con exactamente el mismo
            contenido.
          </Alert>
        )}

        {guardado.descartadas > 0 && (
          <Alert
            tono="aviso"
            titulo={`${pluralizar(guardado.descartadas, 'fila descartada', 'filas descartadas')}`}
          >
            Sin DNI, sin Fecha, o sin ninguno de los dos. Una fila a la que le falta
            cualquiera de esos dos datos no se puede atribuir a una persona en un día, así
            que no se guarda.
          </Alert>
        )}

        {resumen.diasSinFecha > 0 && (
          <Alert
            tono="aviso"
            titulo={`${pluralizar(resumen.diasSinFecha, 'día', 'días')} con fecha ilegible`}
          >
            Están guardados, pero su columna Fecha no tiene el formato DD/MM/AAAA, así que no
            caen en ningún período y no se van a ver en las pantallas filtradas por fecha.
          </Alert>
        )}

        {resumen.columnasFaltantes.length > 0 && (
          <Alert tono="aviso" titulo="Faltan columnas que el sistema usa">
            La planilla no trae {resumen.columnasFaltantes.join(', ')}. Las filas se
            guardaron igual, pero todo lo que se deriva de esas columnas —fichadas, turno,
            horas, tardanzas— va a salir vacío o en cero.
          </Alert>
        )}
      </div>
    </Card>
  );
}
