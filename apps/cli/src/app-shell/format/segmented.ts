export type Segment = { readonly label: string; readonly text: string; readonly active: boolean };

/**
 * Pure geometry for tab strips and segmented controls. The active segment gets
 * pill padding (a leading/trailing space) so callers can render it with a fill
 * background that reads as a physical button.
 */
export function segmentGeometry(labels: readonly string[], activeIndex: number): Segment[] {
  if (labels.length === 0) return [];
  const active = Math.max(0, Math.min(labels.length - 1, Math.trunc(activeIndex)));
  return labels.map((label, index) => ({
    label,
    text: index === active ? ` ${label} ` : label,
    active: index === active,
  }));
}
