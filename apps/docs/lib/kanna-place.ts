/**
 * Where Kanna was left, remembered across pages and visits.
 *
 * Stored as a share of the window (0 to 1 each way), not as pixels, so a place chosen
 * on a wide desktop is still on screen on a phone and after a resize. Read back
 * strictly: the stored text came from a browser, which anyone can edit, so anything
 * that is not exactly two numbers in range is ignored and she starts fresh instead of
 * being drawn off the page.
 */

export const PLACE_KEY = "kunai.roamer.place";

export type Place = {
  readonly fx: number;
  readonly fy: number;
};

/** A position in pixels. */
export type Point = {
  readonly x: number;
  readonly y: number;
};

export type Viewport = {
  readonly width: number;
  readonly height: number;
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** A position in pixels as a share of the window. */
export function toPlace(pos: { x: number; y: number }, view: Viewport): Place {
  if (view.width <= 0 || view.height <= 0) return { fx: 0.5, fy: 0.5 };
  return { fx: clamp(pos.x / view.width, 0, 1), fy: clamp(pos.y / view.height, 0, 1) };
}

/**
 * A place back to pixels, kept `margin` pixels inside the window so she is never
 * half off the edge of a window that has since been made smaller.
 */
export function fromPlace(place: Place, view: Viewport, margin: number): Point {
  return {
    x: clamp(place.fx * view.width, margin, Math.max(margin, view.width - margin)),
    y: clamp(place.fy * view.height, margin, Math.max(margin, view.height - margin)),
  };
}

/** Parse what was stored, or null for anything that is not a valid place. */
export function parsePlace(stored: string | null): Place | null {
  if (!stored) return null;
  try {
    const value: { fx?: number; fy?: number } | null = JSON.parse(stored);
    const fx = value?.fx;
    const fy = value?.fy;
    if (fx === undefined || fy === undefined) return null;
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    return { fx, fy };
  } catch {
    return null;
  }
}

/** How far from the left and bottom edges she perches on a touch screen. */
export const PERCH_INSET_PX = 44;

export type Seed = {
  readonly at: { readonly x: number; readonly y: number };
  readonly phase: "sitting" | "asleep";
};

/**
 * Where she starts, before anyone has touched anything.
 *
 * The place she was last left wins on any device: someone chose it. Failing that, a
 * touch screen has no pointer to wait for, so she perches in the bottom-left corner,
 * asleep and out of the way, until she is tapped or carried. With a mouse and nothing
 * remembered she has no seed at all and is dropped in beside the pointer on first
 * sight, which is what `null` means here.
 */
export function seedFor(input: {
  readonly perched: boolean;
  readonly saved: Place | null;
  readonly view: Viewport;
  /** Keeps a remembered place off the very edge of a smaller window. */
  readonly margin: number;
}): Seed | null {
  if (input.saved) {
    return { at: fromPlace(input.saved, input.view, input.margin), phase: "sitting" };
  }
  if (input.perched) {
    return {
      at: { x: PERCH_INSET_PX, y: Math.max(PERCH_INSET_PX, input.view.height - PERCH_INSET_PX) },
      phase: "asleep",
    };
  }
  return null;
}
