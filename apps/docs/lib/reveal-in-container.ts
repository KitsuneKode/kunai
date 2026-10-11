/**
 * How far a scroll container has to move to show one of its rows.
 *
 * This replaces `element.scrollIntoView()` for rows inside a scrollable panel.
 * `scrollIntoView` scrolls every scrollable ancestor, so a row that is already
 * visible inside its panel still drags the *page* until the row is on screen.
 * Hovering a chart that drives such a row made the whole window lurch toward the
 * table on every day boundary the pointer crossed. Moving only the panel's own
 * `scrollTop` cannot touch anything else.
 *
 * Positive scrolls down, negative scrolls up, zero means already visible. A
 * sticky header covers the top of the panel, so a row hidden behind it counts as
 * not visible.
 */
export function scrollDeltaToReveal(
  row: { readonly top: number; readonly bottom: number },
  view: { readonly top: number; readonly bottom: number },
  stickyHeight = 0,
): number {
  const visibleTop = view.top + stickyHeight;
  if (row.top < visibleTop) return row.top - visibleTop;
  if (row.bottom > view.bottom) return row.bottom - view.bottom;
  return 0;
}

/** Scroll `container` just enough to show `row`, leaving the page where it is. */
export function revealWithin(container: HTMLElement, row: HTMLElement, stickyHeight = 0): void {
  const delta = scrollDeltaToReveal(
    row.getBoundingClientRect(),
    container.getBoundingClientRect(),
    stickyHeight,
  );
  if (delta !== 0) container.scrollTop += delta;
}
