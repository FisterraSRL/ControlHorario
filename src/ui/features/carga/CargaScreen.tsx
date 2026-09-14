import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { Dropzone } from '../../components/molecules/Dropzone/Dropzone.js';
import { ResumenDeCarga } from './ResumenDeCarga.js';
import type { ResumenCarga } from './resumen.js';
import './carga.css';

export interface CargaScreenProps {
  readonly onArchivo: (archivo: File) => void;
  readonly procesando: boolean;
  /** Anything that went wrong reading the file or writing the historial. */
  readonly error: string | null;
  readonly resumen: ResumenCarga | null;
  readonly cargandoHistorial: boolean;
  /** Size of the accumulated historial, so the screen is not blank on a fresh page load. */
  readonly diasEnHistorial: number;
}

/**
 * Presentational: everything it renders arrives as a prop. It does not read a file, does
 * not import `src/domain` and does not know a repository exists — `CargaContainer` does all
 * three and hands the results down.
 */
export function CargaScreen({
  onArchivo,
  procesando,
  error,
  resumen,
  cargandoHistorial,
  diasEnHistorial,
}: CargaScreenProps) {
  return (
    <>
      <Card
        titulo="Importar planilla de QUICKPASS"
        bajada={
          <>
            Subí el Excel de fichadas en crudo, tal como lo exporta QUICKPASS, con las
            columnas Sector, Usuario, DNI, Fecha, Movimientos, Turno y las demás. Cada día que
            trae se suma al historial acumulado identificado por DNI y fecha, así que podés
            subir distintos períodos en momentos distintos, y volver a subir un período ya
            cargado para corregirlo sin perder los otros.
          </>
        }
      >
        <Dropzone
          onArchivo={onArchivo}
          accept=".xlsx,.xls"
          titulo={procesando ? 'Leyendo la planilla…' : 'Hacé clic para elegir un archivo .xlsx'}
          ayuda={procesando ? 'Un momento' : 'o arrastralo hasta acá'}
          disabled={procesando}
        />

        {error && (
          <div className="carga__error">
            <Alert tono="error" titulo="No se pudo cargar la planilla">
              {error}
            </Alert>
          </div>
        )}
      </Card>

      {resumen ? (
        <ResumenDeCarga resumen={resumen} />
      ) : (
        !cargandoHistorial &&
        diasEnHistorial > 0 && (
          <Card titulo="Historial acumulado">
            <p className="carga__estado">
              Ya hay <b>{diasEnHistorial}</b> {diasEnHistorial === 1 ? 'día' : 'días'} de
              fichadas cargados de subidas anteriores. Subir otra planilla los conserva: solo
              se reemplazan los días que vuelvan a venir en el archivo nuevo.
            </p>
          </Card>
        )
      )}
    </>
  );
}
