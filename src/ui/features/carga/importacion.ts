import type { FilaQuickpass } from '../../../domain/fichadas/index.js';
import type { ResultadoGuardado } from '../../historial/RepositorioFichadas.js';
import { leerPlanilla, type PlanillaLeida } from './planilla.js';
import { prepararVistaPrevia, type VistaPrevia } from './vistaPrevia.js';

export interface EstadoImportacion {
  fase: 'inicial' | 'leyendo' | 'previa' | 'guardando' | 'terminada' | 'error';
  previa: VistaPrevia | null;
  error: string | null;
  ultima: { planilla: PlanillaLeida; guardado: ResultadoGuardado } | null;
}
export const estadoInicial: EstadoImportacion = { fase: 'inicial', previa: null, error: null, ultima: null };

/** A generation invalidates stale reads. The synchronous phase guard prevents double writes. */
export function crearImportacion(deps: {
  leer?: (archivo: File) => Promise<PlanillaLeida>;
  historial: () => { filas: readonly FilaQuickpass[]; disponible: boolean };
  guardar: (filas: readonly FilaQuickpass[]) => Promise<ResultadoGuardado>;
  publicar: (estado: EstadoImportacion) => void;
}) {
  let estado = estadoInicial;
  let revision = 0;
  const publicar = (nuevo: EstadoImportacion) => { estado = nuevo; deps.publicar(nuevo); };
  return {
    cancelar() {
      if (estado.fase === 'guardando') return;
      revision++;
      publicar(estadoInicial);
    },
    async seleccionar(archivo: File) {
      if (estado.fase === 'guardando') return;
      const actual = ++revision;
      publicar({ ...estadoInicial, fase: 'leyendo' });
      try {
        const planilla = await (deps.leer ?? leerPlanilla)(archivo);
        if (revision !== actual) return;
        const historial = deps.historial();
        if (!historial.disponible) throw new Error('No se pudo comparar con el historial. Reintentá la lectura del historial y luego elegí nuevamente el archivo.');
        publicar({ ...estadoInicial, fase: 'previa', previa: prepararVistaPrevia(planilla, historial.filas) });
      } catch (e) {
        if (revision === actual) publicar({ ...estadoInicial, fase: 'error', error: e instanceof Error ? e.message : 'No se pudo leer el archivo.' });
      }
    },
    async confirmar() {
      if (estado.fase !== 'previa' || !estado.previa || estado.previa.errores.length) return;
      if (!deps.historial().disponible) return;
      const previa = estado.previa;
      // Consume the candidate before the first await; any uncertain result requires a new preview.
      publicar({ ...estadoInicial, fase: 'guardando', previa });
      try {
        const guardado = await deps.guardar(previa.filas);
        publicar({ ...estadoInicial, fase: 'terminada', ultima: { planilla: previa.planilla, guardado } });
      } catch {
        publicar({ ...estadoInicial, fase: 'error', error: 'No se pudo confirmar el resultado de la importación. Es posible que los datos se hayan guardado. Actualizá el historial y revisalo antes de volver a elegir el archivo. No se reintentó el guardado.' });
      }
    },
  };
}
