export type Segment = { readonly label: string; readonly text: string; readonly active: boolean };

/**
 * Pure geometry for tab strips and segmented controls. The active segment gets
 * pill padding (a leading/trailing space) so callers can render it with a fill
 * background that reads as a physical button.
 */
export function segmentGeometry(labels: readonly string[], activeIndex: number): Segment[] {
  if (labels.length === 0) return [];
  const active = clampIndex(labels, activeIndex);
  return labels.map((label, index) => ({
    label,
    text: index === active ? ` ${label} ` : label,
    active: index === active,
  }));
}

export type SegmentWindow = {
  readonly segments: readonly Segment[];
  readonly hiddenBefore: number;
  readonly hiddenAfter: number;
};

/** Gap rendered between two segments. */
const SEGMENT_GAP = 2;
/** Width of a `‹`/`›` overflow marker plus its gap. */
const MARKER_WIDTH = 2;

function clampIndex(labels: readonly string[], index: number): number {
  return Math.max(0, Math.min(labels.length - 1, Math.trunc(index)));
}

function segmentWidth(label: string, active: boolean): number {
  return active ? label.length + 2 : label.length;
}

/**
 * Fit a tab strip into a fixed width by showing a window around the active tab.
 *
 * Letting the layout engine shrink the segments instead turns twelve section
 * names into a column of two-character stumps that wrap into an unreadable
 * second line — at 80 columns, the classic terminal default, the Settings
 * strip became actively misleading about which sections exist.
 *
 * The active label is always shown in full, because it is the one piece of
 * state the strip has to communicate. Neighbours are added outward until the
 * width runs out, and the counts of what did not fit let the caller render
 * `‹`/`›` so the strip reads as scrollable rather than complete.
 */
export function windowedSegmentGeometry(
  labels: readonly string[],
  activeIndex: number,
  availableWidth: number,
): SegmentWindow {
  if (labels.length === 0) return { segments: [], hiddenBefore: 0, hiddenAfter: 0 };

  const all = segmentGeometry(labels, activeIndex);
  const active = clampIndex(labels, activeIndex);
  const total = all.reduce(
    (sum, seg, index) => sum + segmentWidth(seg.label, seg.active) + (index > 0 ? SEGMENT_GAP : 0),
    0,
  );
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || total <= availableWidth) {
    return { segments: all, hiddenBefore: 0, hiddenAfter: 0 };
  }

  let first = active;
  let last = active;
  // The active pill alone may exceed the budget on a very narrow terminal; it
  // is still the only segment worth showing, so it is never dropped.
  let used = segmentWidth(labels[active] ?? "", true);

  // Reserve marker space up front rather than discovering mid-loop that adding
  // a neighbour pushed the marker off the end.
  const budget = availableWidth - MARKER_WIDTH * 2;

  for (;;) {
    const nextAfter = last + 1;
    const nextBefore = first - 1;
    const canAfter = nextAfter < labels.length;
    const canBefore = nextBefore >= 0;
    if (!canAfter && !canBefore) break;

    // Forward first: later sections are the ones a user has not seen yet.
    const takeAfter = canAfter;
    const index = takeAfter ? nextAfter : nextBefore;
    const cost = segmentWidth(labels[index] ?? "", false) + SEGMENT_GAP;
    if (used + cost > budget) {
      if (!takeAfter) break;
      // Forward did not fit; backward may still be narrower.
      if (!canBefore) break;
      const backCost = segmentWidth(labels[nextBefore] ?? "", false) + SEGMENT_GAP;
      if (used + backCost > budget) break;
      first = nextBefore;
      used += backCost;
      continue;
    }
    if (takeAfter) last = nextAfter;
    else first = nextBefore;
    used += cost;
  }

  return {
    segments: all.slice(first, last + 1),
    hiddenBefore: first,
    hiddenAfter: labels.length - 1 - last,
  };
}
