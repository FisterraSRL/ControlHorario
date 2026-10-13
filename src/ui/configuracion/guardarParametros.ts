import type { ParametrosConfiguracion, RepositorioConfiguracion, ResultadoParametros } from './RepositorioConfiguracion.js';

/** Never turn a rejected repository write into a fulfilled success acknowledgement. */
export async function guardarParametrosConfirmados(
  repo: Pick<RepositorioConfiguracion, 'guardarParametros'>,
  cambios: Partial<ParametrosConfiguracion>,
  alFallar: (error: unknown) => void,
): Promise<ResultadoParametros> {
  try {
    return { ok: true, parametros: await repo.guardarParametros(cambios) };
  } catch (error: unknown) {
    alFallar(error);
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo guardar la configuración.' };
  }
}
