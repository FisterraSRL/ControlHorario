import './BrandLockup.css';

/**
 * The Fisterra horizontal lockup.
 *
 * Derived from `src/ui/tokens/brand/fisterra-lockup-horizontal.svg`, which is the vendored
 * brand asset and stays byte-identical to the file in `Assets - Fisterra`. It is inlined
 * here rather than referenced as an `<img>` for one reason: the brand file paints the
 * wordmark in `#0A2F43`, which is exactly the surface colour of the sidebar in dark mode,
 * so as a flat image the word FISTERRA disappears. Inlined, the wordmark takes
 * `currentColor` and the isotipo keeps its two brand reds, which are the part that must not
 * move.
 *
 * The geometry, the letter-spacing and the reds are copied from the asset unchanged. THE
 * VIEWBOX IS NOT, and that is deliberate. The asset's `0 0 420 100` is narrower than its own
 * wordmark: set in Montserrat at 68 the word measures 348 units from x=140, so it ends at
 * 488 and an SVG — which clips to its viewBox — cuts off the final A and half of the R. The
 * asset has the same defect wherever it is used as an image; it has to be fixed at the source
 * and re-vendored, not edited here. This component widens the box to fit the word and pins
 * the word's width with `textLength`, so a fallback font with wider glyphs is squeezed into
 * the same 348 units instead of overflowing again.
 *
 * `xMinYMid` keeps the drawing against the left edge if a layout ever stretches the element
 * wider than its aspect ratio; the default centres it, which is how the sidebar ended up with
 * a logo floating 50px to the right of everything under it.
 *
 * If the brand file changes, re-vendor it and re-derive this component; do not drift them
 * apart beyond the box.
 */
const ANCHO_PALABRA = 348;
const X_PALABRA = 140;
/** Margin past the last glyph's advance: the A's diagonal can ink a little beyond it. */
const ANCHO_CAJA = X_PALABRA + ANCHO_PALABRA + 8;

export function BrandLockup({ className }: { readonly className?: string }) {
  return (
    <svg
      className={['brand-lockup', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${ANCHO_CAJA} 100`}
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label="Fisterra"
    >
      <g transform="translate(0,4) scale(0.92)">
        <path d="M50 0 L0 100 Q25 95.2 50 95.2 Z" fill="var(--fs-red)" />
        <path d="M50 0 L50 95.2 Q75 95.2 100 100 Z" fill="var(--fs-red-deep)" />
      </g>
      <text
        x={X_PALABRA}
        y="72"
        fontFamily="var(--app-font)"
        fontSize="68"
        fontWeight="400"
        letterSpacing="1"
        textLength={ANCHO_PALABRA}
        lengthAdjust="spacingAndGlyphs"
        fill="currentColor"
      >
        FISTERRA
      </text>
    </svg>
  );
}
