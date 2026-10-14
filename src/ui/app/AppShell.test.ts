import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Sidebar } from '../components/organisms/Sidebar/Sidebar.js';
import { AppShellScreen } from './AppShell.js';
import { modulosDeRol } from './navegacion.js';
import type { RolUsuario } from '../roles.js';

function render(compact: boolean, menuOpen: boolean, rol: RolUsuario = 'admin') {
  const items = modulosDeRol(rol).map((section) => ({
    path: section.path, label: section.label, icono: section.icono,
    contador: section.id === 'ausencias' ? 3 : null,
  }));
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AppShellScreen, {
      sidebar: createElement(Sidebar, { items, rutaActiva: '/ausencias' }),
      topbar: createElement('header', null, 'Ausencias'),
      compact, menuOpen, menuId: 'sections', onToggle: () => {},
      children: createElement('p', null, 'Contenido de la pantalla'),
    }),
  ));
}

describe('responsive navigation accessibility', () => {
  it('removes collapsed mobile links from focus and accessibility traversal with native hidden', () => {
    const html = render(true, false);
    expect(html).toContain('aria-expanded="false" aria-controls="sections"');
    expect(html).toContain('id="sections" class="shell__navigation" hidden=""');
    expect(html).toContain('<main class="shell__content"><p>Contenido de la pantalla</p></main>');
    expect(html).not.toContain('class="shell__mobile-bar" hidden');
  });

  it('exposes the same section list and selected page when the mobile menu opens', () => {
    const html = render(true, true);
    expect(html).toContain('aria-expanded="true" aria-controls="sections"');
    expect(html).not.toContain('class="shell__navigation" hidden');
    expect(html).toContain('aria-label="Secciones"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('>Ausencias</span>');
    expect(html).toContain('>3</span>');
  });

  it('keeps desktop navigation available regardless of the mobile disclosure state', () => {
    for (const menuOpen of [false, true]) {
      const html = render(false, menuOpen);
      expect(html).not.toContain('class="shell__navigation" hidden');
      expect(html).toContain('class="shell__mobile-bar" hidden=""');
      expect(html.match(/aria-label="Secciones"/g)).toHaveLength(1);
    }
  });

  it('preserves role restrictions in the expanded menu', () => {
    const html = render(true, true, 'encargado');
    expect(html).toContain('href="/ausencias"');
    expect(html).not.toContain('href="/mi-cuenta"');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain('href="/usuarios"');
    expect(html).not.toContain('href="/carga"');
  });
});
