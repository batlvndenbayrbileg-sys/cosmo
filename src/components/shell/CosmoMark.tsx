/**
 * The Cosmo mark: a ring with three stars, one per status shape (circle, triangle, diamond), so
 * the mark itself repeats the "status is never colour alone" idea. Decorative.
 */
export function CosmoMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="16" cy="16" r="11.5" fill="none" strokeWidth="1.6" stroke="var(--cosmo-accent-deep)" />
      <circle cx="16" cy="16" r="3.2" fill="var(--cosmo-ink)" />
      <circle cx="16" cy="4.5" r="2.6" className="fill-status-ok" />
      <polygon points="26 21.6 29.2 27 22.8 27" className="fill-status-watch" />
      <polygon points="6 20 8.4 22.8 6 25.6 3.6 22.8" className="fill-status-alert" />
    </svg>
  );
}
