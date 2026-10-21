// Pattern adapted from Watermelon "Continuous Tabs" (MIT), see docs/WATERMELON_LICENSE.txt.
// Geometry for the single moving active-tab indicator, kept pure so it can be tested without a browser.

export interface Box {
  left: number;
  top: number;
  bottom: number;
  width: number;
}
export interface Placement {
  x: number;
  y: number;
  w: number;
}
/** Matches the 3 px `--brand` underline the per-tab fallback draws. */
export const INDICATOR_HEIGHT = 3;
/** Transition for moving between tabs (docs/BRAND.md: 120-180 ms, transform only). Mirrors the CSS. */
export const INDICATOR_TRANSITION_MS = 150;

const round = (n: number) => Math.round(n * 100) / 100;

/** Where the indicator sits: along the bottom edge of the active tab, relative to the tab row. Null when it cannot be measured. */
export function indicatorPlacement(container: Box, tab: Box): Placement | null {
  const placement = { x: round(tab.left - container.left), y: round(tab.bottom - container.top - INDICATOR_HEIGHT), w: round(tab.width) };
  return Number.isFinite(placement.x) && Number.isFinite(placement.y) && Number.isFinite(placement.w) && placement.w > 0 ? placement : null;
}
/** Tabs wrap onto rows on narrow screens; the indicator slides only along one row and jumps between rows. */
export const sameRow = (a: Placement, b: Placement) => Math.abs(a.y - b.y) < 1;
/** The element is 1 px wide and scaled to the tab, so a move or a resize is a single compositor-only transform. */
export const indicatorTransform = (p: Placement) => `translate3d(${p.x}px, ${p.y}px, 0) scaleX(${p.w})`;
