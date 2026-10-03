/**
 * "Has the visitor scrolled past this point?", the one rule the nav and the
 * back-to-top button both use.
 *
 * A zero-size sentinel sits a fixed distance down the page and an
 * `IntersectionObserver` watches it. While it is on screen the visitor is still near
 * the top; once it has scrolled up out of the viewport they are past it. The rule is
 * "not intersecting AND above the viewport", not just "not intersecting": a sentinel
 * that is below the fold on a very short viewport is also not intersecting, and
 * nothing may react for a visitor who has not scrolled at all.
 *
 * Pure so it is tested without a browser; the components only report what the
 * observer saw. No scroll listener anywhere: the observer costs nothing between the
 * one transition that matters.
 */
export function isScrolledPast(entry: {
  readonly isIntersecting: boolean;
  readonly top: number;
}): boolean {
  return !entry.isIntersecting && entry.top < 0;
}

/** Scroll distance, in pixels, before the back-to-top button appears: about a screen and a half. */
export const BACK_TO_TOP_AFTER_PX = 720;
