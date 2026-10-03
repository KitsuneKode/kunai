import { isScrolledPast } from "./scrolled-past";

/**
 * When the floating nav should shrink, and when a shrunken nav stays open.
 *
 * ## Compacting
 *
 * A zero-size sentinel sits a short way down the page. While it is on screen the
 * visitor is still at the top and the nav keeps its full size; once it has
 * scrolled up out of the viewport, the nav compacts. Using "not intersecting AND
 * above the viewport" rather than just "not intersecting" matters: a sentinel that
 * is below the fold on a very short viewport is also not intersecting, and the nav
 * must not shrink for a visitor who has not scrolled at all.
 *
 * ## Staying open
 *
 * A compact nav opens three ways. Keyboard focus is pure CSS. Hover is the rule
 * below, which needs a little state. The third is a click or tap on the expander,
 * which "pins" it open so a touch screen, which has no hover, can reach the links
 * at all. A pinned nav closes on an outside press, on Escape, or when the page
 * scrolls back to the top (where it is full size anyway).
 *
 * ## Opening on hover, without moving the target
 *
 * The compact bar is a few controls wide and expands about its centre, so every
 * control but the middle one slides away when it opens. Aiming at the search icon
 * and watching it run 350px sideways is the worst thing this bar could do. So
 * hovering the brand or the search icon does not open it: they are the controls a
 * visitor aims at on purpose, and they stay put. Everything else in the pill (the
 * dots, the padding) opens it. Once it is open it stays open while the pointer is
 * anywhere inside it, including on the brand or search, so moving to them along
 * the way does not fold it shut under the cursor.
 *
 * These rules are pure so they are tested without a browser; the component only
 * reports what the DOM did.
 */
export function shouldCompactNav(entry: {
  readonly isIntersecting: boolean;
  readonly top: number;
}): boolean {
  return isScrolledPast(entry);
}

/** Scroll distance, in pixels, before the nav shrinks. */
export const NAV_COMPACT_AFTER_PX = 56;

export type NavPinEvent =
  /** The expander was pressed. */
  | "toggle"
  /** A press landed outside the nav. */
  | "outside"
  | "escape"
  /** The page scrolled back to the top, so the nav is full size again. */
  | "uncompact";

/** Whether the compact nav is pinned open after `event`. */
export function nextNavPin(pinned: boolean, event: NavPinEvent): boolean {
  switch (event) {
    case "toggle":
      return !pinned;
    case "outside":
    case "escape":
    case "uncompact":
      return false;
  }
}

/** Where the pointer is, as far as the nav's hover rule cares. */
export type NavPointer = {
  /** Over the floating pill at all. */
  readonly insidePill: boolean;
  /** Over the brand link or the search button, which must not move when aimed at. */
  readonly onSteadyControl: boolean;
};

/** Whether the compact nav is hover-open after the pointer moved to `pointer`. */
export function nextNavHover(hovering: boolean, pointer: NavPointer): boolean {
  if (!pointer.insidePill) return false;
  if (hovering) return true;
  return !pointer.onSteadyControl;
}

/** How long the pointer must rest before the bar opens, so sweeping across it does not. */
export const NAV_HOVER_INTENT_MS = 90;
