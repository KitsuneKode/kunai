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
