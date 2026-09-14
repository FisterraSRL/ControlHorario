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
 * The geometry, the viewBox, the letter-spacing and the reds are copied from the asset
 * unchanged. If the brand file changes, re-vendor it and re-derive this component; do not
 * drift them apart.
 */
export function BrandLockup({ className }: { readonly className?: string }) {
  return (
    <svg
      className={['brand-lockup', className].filter(Boolean).join(' ')}
      viewBox="0 0 420 100"
      role="img"
      aria-label="Fisterra"
    >
      <g transform="translate(0,4) scale(0.92)">
        <path d="M50 0 L0 100 Q25 95.2 50 95.2 Z" fill="var(--fs-red)" />
        <path d="M50 0 L50 95.2 Q75 95.2 100 100 Z" fill="var(--fs-red-deep)" />
      </g>
      <text
        x="140"
        y="72"
        fontFamily="var(--app-font)"
        fontSize="68"
        fontWeight="400"
        letterSpacing="1"
        fill="currentColor"
      >
        FISTERRA
      </text>
    </svg>
  );
}
