import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';

import { BrandLockup } from '../components/atoms/BrandLockup/BrandLockup.js';
import './AppShell.css';

const COMPACT_QUERY = '(max-width: 900px)';

export interface AppShellProps {
  readonly sidebar: (onNavigate: () => void) => ReactNode;
  readonly navigationKey: string;
  readonly topbar: ReactNode | ((onNavigate: () => void) => ReactNode);
  readonly children: ReactNode | ((onNavigate: () => void) => ReactNode);
}

interface AppShellScreenProps extends Omit<AppShellProps, 'sidebar' | 'navigationKey' | 'topbar' | 'children'> {
  readonly sidebar: ReactNode;
  readonly topbar: ReactNode;
  readonly children: ReactNode;
  readonly compact: boolean;
  readonly menuOpen: boolean;
  readonly menuId: string;
  readonly onToggle: () => void;
  readonly menuButtonRef?: Ref<HTMLButtonElement>;
  readonly navigationRef?: Ref<HTMLDivElement>;
}

/** Layout and disclosure semantics, independent of viewport subscriptions. */
export function AppShellScreen({
  sidebar, topbar, children, compact, menuOpen, menuId, onToggle,
  menuButtonRef, navigationRef,
}: AppShellScreenProps) {
  return (
    <div className="shell">
      <div className="shell__mobile-bar" hidden={!compact}>
        <BrandLockup className="shell__mobile-brand" />
        <button
          ref={menuButtonRef}
          type="button"
          className="shell__menu-toggle"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={onToggle}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={menuOpen ? 'M6 6l12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
          Menú
        </button>
      </div>
      <div id={menuId} ref={navigationRef} className="shell__navigation" hidden={compact && !menuOpen}>
        {sidebar}
      </div>
      <div className="shell__main">
        {topbar}
        <main className="shell__content">{children}</main>
      </div>
    </div>
  );
}

/** Responsive navigation only; business state remains in AppLayout. */
export function AppShell({ sidebar, navigationKey, topbar, children }: AppShellProps) {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<'menu' | 'navigation' | null>(null);
  const lastFocused = useRef<EventTarget | null>(null);
  const menuId = useId();

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    if (navigation.current?.contains(document.activeElement)) menuButton.current?.focus();
  }, []);
  const onNavigate = useCallback(() => { if (compact) closeMenu(); }, [compact, closeMenu]);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    // CSS can hide a focused control before matchMedia dispatches its change event.
    // Remember the last actual control, and use it only if focus fell back to the body.
    const rememberFocus = (event: FocusEvent) => {
      if (event.target !== document.body) lastFocused.current = event.target;
    };
    const update = () => {
      const focused = document.activeElement === document.body
        ? lastFocused.current
        : document.activeElement;
      if (query.matches && focused instanceof Node && navigation.current?.contains(focused)) {
        pendingFocus.current = 'menu';
      } else if (!query.matches && focused === menuButton.current) {
        pendingFocus.current = 'navigation';
      }
      setCompact(query.matches);
    };
    document.addEventListener('focusin', rememberFocus);
    update();
    query.addEventListener('change', update);
    return () => {
      document.removeEventListener('focusin', rememberFocus);
      query.removeEventListener('change', update);
    };
  }, []);

  // A resize or browser-history navigation never preserves an open mobile menu, nor focus
  // in links that just became hidden. The desktop rail stays visible regardless of state.
  useLayoutEffect(() => {
    if (compact) closeMenu();
    else setMenuOpen(false);
    if (pendingFocus.current === 'menu') menuButton.current?.focus();
    if (pendingFocus.current === 'navigation') {
      const selected = navigation.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
      const first = navigation.current?.querySelector<HTMLAnchorElement>('a');
      (selected ?? first)?.focus();
    }
    pendingFocus.current = null;
  }, [compact, navigationKey, closeMenu]);

  useEffect(() => {
    if (!compact || !menuOpen) return undefined;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeMenu();
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [compact, menuOpen, closeMenu]);

  return (
    <AppShellScreen
      sidebar={sidebar(onNavigate)}
      topbar={typeof topbar === 'function' ? topbar(onNavigate) : topbar}
      compact={compact}
      menuOpen={menuOpen}
      menuId={menuId}
      menuButtonRef={menuButton}
      navigationRef={navigation}
      onToggle={() => setMenuOpen((open) => !open)}
    >
      {typeof children === 'function' ? children(onNavigate) : children}
    </AppShellScreen>
  );
}
