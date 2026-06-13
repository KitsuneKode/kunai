export type BarSegments = { readonly filled: number; readonly track: number };

/**
 * Splits a fixed-width bar into filled + track segments. One bar per row — the
 * fix for the collapsed/overlapping Stats bars.
 */
export function barFill(value: number, max: number, width: number): BarSegments {
  if (width <= 0) return { filled: 0, track: 0 };
  if (max <= 0 || value <= 0) return { filled: 0, track: width };
  const ratio = Math.min(1, value / max);
  const filled = Math.round(ratio * width);
  return { filled, track: width - filled };
}

/**
 * Compact single-color progress meter (e.g. "▰▰▱▱▱") for single-line list rows —
 * keeps continue-watching rows scannable without a full-width detached bar.
 */
export function compactProgressBar(percentage: number, cells = 5): string {
  const safe = Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0;
  // Any started title shows at least one filled cell (Netflix-style sliver) so a
  // low percent never reads as "not started".
  const filled = safe <= 0 ? 0 : Math.max(1, Math.round((safe / 100) * cells));
  return "▰".repeat(filled) + "▱".repeat(cells - filled);
}
