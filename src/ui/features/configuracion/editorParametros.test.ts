import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ParametrosConfiguracion, ResultadoParametros } from '../../configuracion/RepositorioConfiguracion.js';
import { ConfiguracionScreen } from './ConfiguracionScreen.js';
import { crearEditorParametros, validarParametro } from './editorParametros.js';

const INICIALES: ParametrosConfiguracion = {
  horasTurnoSemanales: 40, descansoMaxMin: 30, toleranciaMin: 5, tardanzasPerdonadasSemana: 1,
};

function preparar() {
  const guardar = vi.fn(async (cambios: Partial<ParametrosConfiguracion>): Promise<ResultadoParametros> => (
    { ok: true, parametros: { ...INICIALES, ...cambios } }
  ));
  const editor = crearEditorParametros(guardar);
  editor.recibir(INICIALES);
  return { editor, guardar };
}

function diferida() {
  let resolver!: (resultado: ResultadoParametros) => void;
  const promesa = new Promise<ResultadoParametros>((resolve) => { resolver = resolve; });
  return { promesa, resolver };
}

describe('explicit parameter draft', () => {
  it('edits only a draft until an explicit save, preserving persisted engine values', () => {
    const { editor, guardar } = preparar();
    editor.editar('descansoMaxMin', '45');
    editor.editar('toleranciaMin', '7');
    expect(guardar).not.toHaveBeenCalled();
    expect(editor.leer().guardados).toEqual(INICIALES);
    expect(editor.leer().borrador?.descansoMaxMin).toBe('45');
  });

  it('cancels every edit and error without writing', () => {
    const { editor, guardar } = preparar();
    editor.editar('horasTurnoSemanales', '50');
    editor.editar('tardanzasPerdonadasSemana', '1.5');
    editor.cancelar();
    expect(editor.leer().borrador?.horasTurnoSemanales).toBe('40');
    expect(editor.leer().borrador?.tardanzasPerdonadasSemana).toBe('1');
    expect(editor.leer().errores).toEqual({});
    expect(guardar).not.toHaveBeenCalled();
  });

  it.each([
    ['descansoMaxMin', '', 'Ingresá un valor.'],
    ['toleranciaMin', '-1', 'Ingresá un valor entre 0 y 1440.'],
    ['horasTurnoSemanales', '169', 'Ingresá un valor entre 0 y 168.'],
    ['tardanzasPerdonadasSemana', '8', 'Ingresá un valor entre 0 y 7.'],
    ['descansoMaxMin', '3.5', 'Ingresá un número entero.'],
    ['toleranciaMin', '3.5', 'Ingresá un número entero.'],
    ['tardanzasPerdonadasSemana', '1,5', 'Ingresá un número entero.'],
    ['horasTurnoSemanales', 'número', 'Ingresá un número válido.'],
  ] as const)('blocks %s = %s without discarding the invalid input', async (campo, texto, mensaje) => {
    const { editor, guardar } = preparar();
    editor.editar(campo, texto);
    await editor.guardar();
    expect(editor.leer().errores[campo]).toBe(mensaje);
    expect(editor.leer().borrador?.[campo]).toBe(texto);
    expect(guardar).not.toHaveBeenCalled();
    expect(editor.leer().aviso).toBeNull();
  });

  it('accepts zero, contractual decimals with comma, and limits', () => {
    expect(validarParametro('horasTurnoSemanales', '40,25')).toBeNull();
    expect(validarParametro('horasTurnoSemanales', '168')).toBeNull();
    expect(validarParametro('toleranciaMin', '0')).toBeNull();
    expect(validarParametro('descansoMaxMin', '1440')).toBeNull();
    expect(validarParametro('tardanzasPerdonadasSemana', '7')).toBeNull();
  });

  it('writes changed fields together and uses the returned authoritative values', async () => {
    const { editor, guardar } = preparar();
    guardar.mockResolvedValueOnce({ ok: true, parametros: { ...INICIALES, horasTurnoSemanales: 40.25, toleranciaMin: 8, descansoMaxMin: 35 } });
    editor.editar('horasTurnoSemanales', '40,25');
    editor.editar('toleranciaMin', '8');
    await editor.guardar();
    expect(guardar).toHaveBeenCalledExactlyOnceWith({ horasTurnoSemanales: 40.25, toleranciaMin: 8 });
    expect(editor.leer().guardados?.descansoMaxMin).toBe(35);
    expect(editor.leer().borrador?.horasTurnoSemanales).toBe('40.25');
    expect(editor.leer().aviso?.tono).toBe('ok');
    editor.editar('toleranciaMin', '9');
    expect(editor.leer().aviso).toBeNull();
  });

  it('does not write or announce success for an unchanged or numerically equivalent form', async () => {
    const { editor, guardar } = preparar();
    await editor.guardar();
    editor.editar('horasTurnoSemanales', '40.0');
    await editor.guardar();
    expect(guardar).not.toHaveBeenCalled();
    expect(editor.leer().aviso).toBeNull();
    expect(editor.leer().borrador?.horasTurnoSemanales).toBe('40');
  });

  it('preserves the draft on failure and supports an explicit retry', async () => {
    const { editor, guardar } = preparar();
    guardar.mockResolvedValueOnce({ ok: false, error: 'Fallo de prueba.' });
    editor.editar('toleranciaMin', '8');
    await editor.guardar();
    expect(editor.leer().guardados).toEqual(INICIALES);
    expect(editor.leer().borrador?.toleranciaMin).toBe('8');
    expect(editor.leer().aviso).toEqual({ tono: 'error', texto: 'Fallo de prueba.' });
    await editor.guardar();
    expect(guardar).toHaveBeenCalledTimes(2);
    expect(editor.leer().aviso?.tono).toBe('ok');
  });

  it('handles an unexpected rejected promise without losing the input', async () => {
    const { editor, guardar } = preparar();
    guardar.mockRejectedValueOnce(new Error('Error inesperado.'));
    editor.editar('toleranciaMin', '8');
    await editor.guardar();
    expect(editor.leer().borrador?.toleranciaMin).toBe('8');
    expect(editor.leer().aviso).toEqual({ tono: 'error', texto: 'Error inesperado.' });
  });

  it('blocks repeat saves, editing, and cancellation during a pending write', async () => {
    const { editor, guardar } = preparar();
    const pendiente = diferida();
    guardar.mockReturnValueOnce(pendiente.promesa);
    editor.editar('toleranciaMin', '8');
    const primera = editor.guardar();
    await editor.guardar();
    editor.editar('toleranciaMin', '9');
    editor.cancelar();
    expect(editor.leer().guardando).toBe(true);
    expect(editor.leer().aviso).toBeNull();
    expect(editor.leer().borrador?.toleranciaMin).toBe('8');
    expect(guardar).toHaveBeenCalledTimes(1);
    pendiente.resolver({ ok: true, parametros: { ...INICIALES, toleranciaMin: 8 } });
    await primera;
    expect(editor.leer().guardando).toBe(false);
    expect(editor.leer().aviso?.tono).toBe('ok');
  });

  it('never enables writes before a configuration is loaded or after it becomes unavailable', async () => {
    const guardar = vi.fn();
    const editor = crearEditorParametros(guardar);
    editor.editar('toleranciaMin', '8');
    await editor.guardar();
    editor.cancelar();
    expect(editor.leer().borrador).toBeNull();
    editor.recibir(INICIALES);
    editor.editar('toleranciaMin', '8');
    editor.recibir(null);
    await editor.guardar();
    expect(guardar).not.toHaveBeenCalled();
  });

  it('preserves edits during a fresh read and cancels back to that latest persisted state', async () => {
    const { editor, guardar } = preparar();
    editor.editar('toleranciaMin', '8');
    editor.recibir({ ...INICIALES, descansoMaxMin: 45 });
    expect(editor.leer().borrador?.descansoMaxMin).toBe('45');
    expect(editor.leer().borrador?.toleranciaMin).toBe('8');
    await editor.guardar();
    expect(guardar).toHaveBeenCalledExactlyOnceWith({ toleranciaMin: 8 });
    editor.recibir({ ...INICIALES, descansoMaxMin: 45 });
    editor.editar('descansoMaxMin', '50');
    editor.cancelar();
    expect(editor.leer().borrador?.descansoMaxMin).toBe('45');
  });

  it('ignores a stale save completion after losing configuration and starting another save', async () => {
    const { editor, guardar } = preparar();
    const vieja = diferida();
    const nueva = diferida();
    guardar.mockReturnValueOnce(vieja.promesa).mockReturnValueOnce(nueva.promesa);
    editor.editar('toleranciaMin', '8');
    const primera = editor.guardar();
    editor.recibir(null);
    editor.recibir(INICIALES);
    editor.editar('toleranciaMin', '9');
    const segunda = editor.guardar();
    vieja.resolver({ ok: true, parametros: { ...INICIALES, toleranciaMin: 8 } });
    await primera;
    expect(editor.leer().guardando).toBe(true);
    expect(editor.leer().aviso).toBeNull();
    nueva.resolver({ ok: true, parametros: { ...INICIALES, toleranciaMin: 9 } });
    await segunda;
    expect(editor.leer().borrador?.toleranciaMin).toBe('9');
  });

  it('renders validation linked to its field with native submit and cancel controls', () => {
    const { editor } = preparar();
    editor.editar('toleranciaMin', '-1');
    const html = renderToStaticMarkup(createElement(ConfiguracionScreen, {
      cargando: false, error: null, estadoParametros: editor.leer(), sectores: [], motivos: [], exclusiones: [], excluibles: [],
      onParametro: editor.editar, onGuardarParametros: () => {}, onCancelarParametros: editor.cancelar,
      onSector: () => {}, onMotivoWorked: () => {}, onMotivoNuevo: () => {}, onMotivoRetirar: () => {}, onExcluir: () => {}, onIncluir: () => {},
    }));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]*toleranciaMin-error"/);
    expect(html).toContain('Ingresá un valor entre 0 y 1440.');
    expect(html).toMatch(/type="submit"[^>]*>Guardar/);
    expect(html).toContain('>Cancelar</button>');
  });
});
