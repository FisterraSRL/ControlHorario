import * as navigation from './navegacion.js';
import { describe, expect, it } from 'vitest';

describe('grouped navigation without changing route permissions', () => {
  it('shows exactly five ordered modules for administration and RRHH', () => {
    for (const role of ['admin', 'operador'] as const) {
      expect(navigation.modulosDeRol(role).map(m => m.label)).toEqual([
        'Cargar datos', 'Ausencias', 'Notificaciones', 'Horas trabajadas', 'Administración',
      ]);
    }
  });
  it('groups every notification deep link with its native destination', () => {
    const paths = ['/notificaciones', '/envios', '/historial-notificaciones', '/indicador'];
    for (const path of paths) {
      expect(navigation.moduloDeRuta(path, 'admin')?.id).toBe('notificaciones');
      expect(navigation.moduloDeRuta(path, 'admin')?.vistas.map(v => v.path)).toEqual(paths);
    }
    expect(navigation.moduloDeRuta('/envios', 'operador')?.vistas.map(v => v.label)).toEqual([
      'Preparar', 'Preparados', 'Historial', 'Resumen',
    ]);
  });
  it('keeps users exclusive to administrators inside administration', () => {
    expect(navigation.moduloDeRuta('/usuarios', 'admin')?.vistas.map(v => v.path)).toEqual(['/configuracion', '/usuarios']);
    expect(navigation.moduloDeRuta('/configuracion', 'operador')?.vistas.map(v => v.path)).toEqual(['/configuracion']);
    expect(navigation.moduloDeRuta('/usuarios', 'operador')).toBeUndefined();
  });
  it('only offers absences to supervisors while preserving their profile route', () => {
    expect(navigation.modulosDeRol('encargado').map(m => m.path)).toEqual(['/ausencias']);
    expect(navigation.seccionesDeRol('encargado').map(s => s.path)).toEqual(['/ausencias', '/mi-cuenta']);
    for (const role of ['admin', 'operador', 'encargado'] as const) {
      expect(navigation.moduloDeRuta('/mi-cuenta', role)).toBeUndefined();
      expect(navigation.seccionesDeRol(role).some(s => s.path === '/mi-cuenta')).toBe(true);
    }
  });
  it('keeps existing counter semantics on their modules', () => {
    expect(navigation.modulosDeRol('admin').filter(m => m.contador).map(m => [m.id, m.contador])).toEqual([
      ['ausencias', 'ausenciasPendientes'], ['notificaciones', 'faltas'], ['horas', 'semanasSinClasificar'],
    ]);
  });
  it('preserves every old URL, guard, initial route and actual period consumer', () => {
    expect(navigation.SECCIONES.map(s => s.path)).toEqual([
      '/carga', '/notificaciones', '/envios', '/historial-notificaciones', '/ausencias', '/indicador',
      '/horas', '/configuracion', '/usuarios', '/mi-cuenta',
    ]);
    expect(navigation.SECCIONES.filter(s => s.muestraPeriodo).map(s => s.path)).toEqual([
      '/notificaciones', '/ausencias', '/indicador', '/horas',
    ]);
    expect(navigation.rutaInicialDeRol('admin')).toBe('/carga');
    expect(navigation.rutaInicialDeRol('operador')).toBe('/carga');
    expect(navigation.rutaInicialDeRol('encargado')).toBe('/ausencias');
  });
});

// Normal navigation dismisses mobile disclosure, including clicks on the current URL.
describe('mobile disclosure navigation callbacks', () => {
  it('dismisses on ordinary current-page, internal-view and profile link clicks', () => {
    for (const destination of ['/envios', '/mi-cuenta', '/notificaciones']) {
      let dismissals = 0;
      navigation.alNavegar(() => { dismissals += 1; })({button:0,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false});
      expect({ destination, dismissals }).toEqual({ destination, dismissals: 1 });
    }
  });
  it('leaves disclosure untouched for middle clicks and modified links', () => {
    let dismissals = 0;
    const ordinary = {button:0,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false};
    for (const changes of [{button:1},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true}]) {
      navigation.alNavegar(() => { dismissals += 1; })({...ordinary,...changes});
    }
    expect(dismissals).toBe(0);
  });
});
