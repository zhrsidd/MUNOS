// Pattern adapted from Watermelon "Skeleton" (MIT), see docs/WATERMELON_LICENSE.txt.

/**
 * Decorative placeholders for a genuine, uncached first read. The container carries the one "Loading ..."
 * announcement; the shapes are hidden from assistive technology. Give `height` and `lines` the dimensions of the
 * rows that will replace it so nothing moves when the content arrives. Never use it while cached data is visible.
 */
export function SkeletonRows({ label, rows = 3, height = 72, lines = 2 }: { label: string; rows?: number; height?: number; lines?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-busy="true" style={{ "--skeleton-row-height": `${height}px` } as React.CSSProperties}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="skeleton-rows">
        {Array.from({ length: rows }, (_, row) => (
          <div className="skeleton-row" key={row}>
            {Array.from({ length: lines }, (_, line) => (
              <span className="skeleton-line" key={line} data-last={line === lines - 1 && lines > 1 ? "true" : "false"} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
