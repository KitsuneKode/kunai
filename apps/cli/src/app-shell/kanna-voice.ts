/**
 * What the companion says.
 *
 * The illustrated fox only reaches four terminals. Copy reaches all of them, so
 * this is where the character actually lives: a single short line, shown on a
 * surface that has nothing else to say, that reads like someone competent
 * telling you where things stand. She is brief on purpose — the product's whole
 * promise is getting out of the way, and a mascot that chatters contradicts it.
 *
 * Rules the pools below keep to, enforced by `kanna-voice.test.ts`:
 *   • one line, `LINE_BUDGET` characters or fewer, so it never wraps a pane
 *   • no exclamation marks, no emoji, no second sentence
 */

import type { CompanionMode } from "./companion-policy";

export type KannaMoment = "empty" | "error";

/** One row at the narrowest pane Kunai lays out, minus the glyph and a space. */
export const LINE_BUDGET = 48;

const LINES = {
  empty: ["nothing here yet.", "empty for now.", "this one's bare."],
  error: ["that didn't work.", "hit a wall on that one.", "couldn't get there."],
} satisfies Record<KannaMoment, readonly string[]>;

export const KANNA_MOMENTS = Object.keys(LINES) as readonly KannaMoment[];

/** Every line in a moment's pool, for tests and for anything that audits copy. */
export function kannaLinesFor(moment: KannaMoment): readonly string[] {
  return LINES[moment];
}

/**
 * The line for a moment at a given pick.
 *
 * Pure on purpose: React renders must not mutate, and a counter here would
 * re-roll the line on every keystroke that re-rendered the pane. Callers hold a
 * `pick` that is stable for as long as the surface is on screen — see
 * `StateBlock` — so the line is chosen once when the surface appears.
 *
 * Any integer is valid; negatives included, so a caller never has to sanitise.
 */
export function kannaLine(moment: KannaMoment, pick: number): string {
  const pool = LINES[moment];
  const index = ((Math.trunc(pick) % pool.length) + pool.length) % pool.length;
  // Pools are non-empty tuples, so the index always resolves.
  return pool[index] as string;
}

/** The moment that fits a state block of this kind, if any deserves a line. */
export function momentForStateKind(kind: string): KannaMoment | null {
  if (kind === "empty") return "empty";
  if (kind === "error") return "error";
  // `loading`, `info` and `success` already say what is happening, and a
  // companion line on top of them is noise rather than presence.
  return null;
}

/**
 * The whole decision for a state surface: whether the companion says anything,
 * and what.
 *
 * Kept pure and out of the component so it can be tested without a terminal, a
 * TTY stub, or a rendered frame. `StateBlock` supplies the mode and a `pick`
 * that is stable for the life of the surface, and renders whatever comes back.
 */
export function companionLineFor(kind: string, mode: CompanionMode, pick: number): string | null {
  if (mode === "off") return null;
  const moment = momentForStateKind(kind);
  return moment === null ? null : kannaLine(moment, pick);
}
