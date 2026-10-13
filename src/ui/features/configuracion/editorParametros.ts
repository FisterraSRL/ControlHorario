import type { ParametrosConfiguracion, ResultadoParametros } from '../../configuracion/RepositorioConfiguracion.js';

export type CampoParametro = keyof ParametrosConfiguracion;
export type BorradorParametros = Readonly<Record<CampoParametro, string>>;
export type ErroresParametros = Readonly<Partial<Record<CampoParametro, string>>>;

export const CAMPOS_PARAMETROS = [
  { campo: 'horasTurnoSemanales', etiqueta: 'Horas de turno por semana', maximo: 168, entero: false,
    ayuda: 'Las horas contractuales, iguales para todos.' },
  { campo: 'descansoMaxMin', etiqueta: 'Descanso máximo (minutos)', maximo: 1440, entero: true,
    ayuda: 'Pasado este tiempo entre la salida y el reingreso, el día genera una falta de descanso.' },
  { campo: 'toleranciaMin', etiqueta: 'Tolerancia de tardanza (minutos)', maximo: 1440, entero: true,
    ayuda: 'Minutos de demora que no generan una tardanza. Cero es tolerancia nula.' },
  { campo: 'tardanzasPerdonadasSemana', etiqueta: 'Tardanzas perdonadas por semana', maximo: 7, entero: true,
    ayuda: 'Las primeras tardanzas de cada persona en la semana (lunes a domingo) no cuentan como falta. Cero no perdona ninguna.' },
] as const;

function aBorrador(parametros: ParametrosConfiguracion): BorradorParametros {
  return {
    horasTurnoSemanales: String(parametros.horasTurnoSemanales),
    descansoMaxMin: String(parametros.descansoMaxMin),
    toleranciaMin: String(parametros.toleranciaMin),
    tardanzasPerdonadasSemana: String(parametros.tardanzasPerdonadasSemana),
  };
}

export function validarParametro(campo: CampoParametro, texto: string): string | null {
  const definicion = CAMPOS_PARAMETROS.find((c) => c.campo === campo)!;
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '') return 'Ingresá un valor.';
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(limpio) || !Number.isFinite(Number(limpio))) {
    return 'Ingresá un número válido.';
  }
  const numero = Number(limpio);
  if (numero < 0 || numero > definicion.maximo) {
    return `Ingresá un valor entre 0 y ${definicion.maximo}.`;
  }
  if (definicion.entero && !Number.isInteger(numero)) return 'Ingresá un número entero.';
  return null;
}

export interface EstadoEditorParametros {
  readonly guardados: ParametrosConfiguracion | null;
  readonly borrador: BorradorParametros | null;
  readonly errores: ErroresParametros;
  readonly guardando: boolean;
  readonly aviso: { readonly tono: 'ok' | 'error'; readonly texto: string } | null;
}

export function parametrosModificados(estado: EstadoEditorParametros): boolean {
  return !!estado.guardados && !!estado.borrador && CAMPOS_PARAMETROS.some(
    ({ campo }) => estado.borrador![campo] !== String(estado.guardados![campo]),
  );
}

/** Draft ownership is separate from persisted engine values. Only guardar can write. */
export function crearEditorParametros(
  guardar: (cambios: Partial<ParametrosConfiguracion>) => Promise<ResultadoParametros>,
) {
  let estado: EstadoEditorParametros = {
    guardados: null, borrador: null, errores: {}, guardando: false, aviso: null,
  };
  const oyentes = new Set<() => void>();
  let generacion = 0;
  const publicar = (siguiente: EstadoEditorParametros): void => {
    estado = siguiente;
    for (const oyente of oyentes) oyente();
  };

  return {
    leer: () => estado,
    suscribir: (oyente: () => void) => {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
    recibir(parametros: ParametrosConfiguracion | null): void {
      if (!parametros) {
        generacion += 1;
        publicar({ guardados: null, borrador: null, errores: {}, guardando: false, aviso: null });
        return;
      }
      const borrador = { ...aBorrador(parametros) };
      // A fresh read may update untouched fields, but must not erase a user's edits.
      if (estado.guardados && estado.borrador) {
        for (const { campo } of CAMPOS_PARAMETROS) {
          if (estado.borrador[campo] !== String(estado.guardados[campo])) {
            borrador[campo] = estado.borrador[campo];
          }
        }
      }
      publicar({ ...estado, guardados: parametros, borrador });
    },
    editar(campo: CampoParametro, texto: string): void {
      if (!estado.borrador || estado.guardando) return;
      const errores = { ...estado.errores };
      const error = validarParametro(campo, texto);
      if (error) errores[campo] = error;
      else delete errores[campo];
      publicar({ ...estado, borrador: { ...estado.borrador, [campo]: texto }, errores, aviso: null });
    },
    cancelar(): void {
      if (!estado.guardados || estado.guardando) return;
      publicar({ ...estado, borrador: aBorrador(estado.guardados), errores: {}, aviso: null });
    },
    async guardar(): Promise<void> {
      if (!estado.guardados || !estado.borrador || estado.guardando) return;
      const errores: Partial<Record<CampoParametro, string>> = {};
      const cambios: Partial<Record<CampoParametro, number>> = {};
      for (const { campo } of CAMPOS_PARAMETROS) {
        const texto = estado.borrador[campo];
        const error = validarParametro(campo, texto);
        if (error) errores[campo] = error;
        else {
          const numero = Number(texto.trim().replace(',', '.'));
          if (numero !== estado.guardados[campo]) cambios[campo] = numero;
        }
      }
      if (Object.keys(errores).length) {
        publicar({ ...estado, errores, aviso: null });
        return;
      }
      if (!Object.keys(cambios).length) {
        publicar({ ...estado, borrador: aBorrador(estado.guardados), errores: {}, aviso: null });
        return;
      }
      publicar({ ...estado, guardando: true, errores: {}, aviso: null });
      const intento = ++generacion;
      let resultado: ResultadoParametros;
      try {
        resultado = await guardar(cambios);
      } catch (error: unknown) {
        resultado = { ok: false, error: error instanceof Error ? error.message : 'No se pudo guardar. Intentá nuevamente.' };
      }
      // A lost configuration (e.g. a session change) cannot be revived by a late write.
      if (intento !== generacion || !estado.guardados || !estado.guardando) return;
      if (resultado.ok) {
        publicar({ guardados: resultado.parametros, borrador: aBorrador(resultado.parametros), errores: {},
          guardando: false, aviso: { tono: 'ok', texto: 'Parámetros guardados correctamente.' } });
      } else {
        publicar({ ...estado, guardando: false, aviso: { tono: 'error', texto: resultado.error } });
      }
    },
  };
}
