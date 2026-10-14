import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import * as sidebar from '../components/organisms/Sidebar/Sidebar.js';
import { Topbar } from '../components/organisms/Topbar/Topbar.js';
import { modulosDeRol, moduloDeRuta } from './navegacion.js';

function markup(child: ReturnType<typeof createElement>, path: string) {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, child));
}

describe('module and profile navigation semantics', () => {
  it('marks the notification parent on every child URL without duplicating page-current semantics', () => {
    const items = modulosDeRol('admin').map(m => ({ ...m, contador: m.id === 'notificaciones' ? 7 : null, rutas: m.vistas.map(v => v.path) }));
    for (const path of ['/envios', '/historial-notificaciones', '/indicador']) {
      const html = markup(createElement(sidebar.Sidebar, { items, rutaActiva: path }), path);
      expect(html).toContain('sidebar__item--activo" aria-current="location"');
      expect(html).toContain('>7</span>');
      expect(html.match(/<a /g)).toHaveLength(5);
      expect(html).not.toContain('href="/mi-cuenta"');
    }
  });
  it('keeps internal destinations as native links with a single current page', () => {
    const html = markup(createElement(sidebar.NavegacionModulo, {
      modulo: moduloDeRuta('/envios', 'admin')!, rutaActiva: '/envios',
    }), '/envios');
    expect(html).toContain('aria-label="Vistas de Notificaciones"');
    expect(html).toContain('href="/envios"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Preparados<\/a>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('>Resumen</a>');
  });
  it('keeps Mi cuenta available in the profile for online and offline sessions', () => {
    for (const sinServidor of [true, false]) {
      const html = markup(createElement(Topbar, {
        titulo: 'Mi cuenta', mostrarPeriodo: false, modos: [], modoActivo: null,
        onModo: () => {}, onDesplazar: () => {}, etiquetaAncla: '', etiquetaRango: null,
        rango: { desde: new Date(0), hasta: new Date(0) }, hoy: new Date(0), onRango: () => {},
        operador: 'Cuenta ficticia', onSalir: () => {}, sinServidor,
      }), '/mi-cuenta');
      expect(html).toContain('href="/mi-cuenta"');
      expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Mi cuenta<\/a>/);
      expect(html).not.toContain('Modo de período');
    }
  });
});
