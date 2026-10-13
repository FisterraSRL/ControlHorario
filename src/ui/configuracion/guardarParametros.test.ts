import { describe, expect, it, vi } from 'vitest';
import { guardarParametrosConfirmados } from './guardarParametros.js';

describe('parameter persistence acknowledgement', () => {
  it('returns only the repository response after the write completes', async () => {
    const parametros = { horasTurnoSemanales: 40, descansoMaxMin: 35, toleranciaMin: 8, tardanzasPerdonadasSemana: 1 };
    const repo = { guardarParametros: vi.fn().mockResolvedValue(parametros) };
    const alFallar = vi.fn();
    expect(await guardarParametrosConfirmados(repo, { toleranciaMin: 8 }, alFallar)).toEqual({ ok: true, parametros });
    expect(repo.guardarParametros).toHaveBeenCalledExactlyOnceWith({ toleranciaMin: 8 });
    expect(alFallar).not.toHaveBeenCalled();
  });

  it('reports rejected writes as failure and forwards the original error for session handling', async () => {
    const error = new Error('El servidor rechazó el cambio.');
    const repo = { guardarParametros: vi.fn().mockRejectedValue(error) };
    const alFallar = vi.fn();
    expect(await guardarParametrosConfirmados(repo, { toleranciaMin: 8 }, alFallar)).toEqual({ ok: false, error: error.message });
    expect(alFallar).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('provides a useful message when rejection is not an Error instance', async () => {
    const repo = { guardarParametros: vi.fn().mockRejectedValue(null) };
    expect(await guardarParametrosConfirmados(repo, { toleranciaMin: 8 }, () => {})).toEqual({ ok: false, error: 'No se pudo guardar la configuración.' });
  });
});
