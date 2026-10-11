/**
 * When the floating nav should shrink.
 *
 * A zero-size sentinel sits a short way down the page. While it is on screen the
 * visitor is still at the top and the nav keeps its full size; once it has
 * scrolled up out of the viewport, the nav compacts. Using "not intersecting AND
 * above the viewport" rather than just "not intersecting" matters: a sentinel that
 * is below the fold on a very short viewport is also not intersecting, and the nav
 * must not shrink for a visitor who has not scrolled at all.
 *
 * Pure so the rule is tested without a browser; the component only reports what
 * the observer saw.
 */
export function shouldCompactNav(entry: {
  readonly isIntersecting: boolean;
  readonly top: number;
}): boolean {
  return !entry.isIntersecting && entry.top < 0;
}

/** Scroll distance, in pixels, before the nav shrinks. */
export const NAV_COMPACT_AFTER_PX = 56;
