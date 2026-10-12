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

import { companionFallbackGlyph, type CompanionMode } from "./companion-policy";

export type KannaMoment = "empty" | "error" | "done";

/** One row at the narrowest pane Kunai lays out, minus the glyph and a space. */
export const LINE_BUDGET = 48;

const LINES = {
  empty: ["nothing here yet.", "empty for now.", "this one's bare."],
  error: ["that didn't work.", "hit a wall on that one.", "couldn't get there."],
  // Success is the moment she earns her keep: the work finished and the shell
  // has nothing to warn about, so the line only has to confirm it landed.
  done: [
    "saved your spot.",
    "queued.",
    "on disk now.",
    "intro dodged.",
    "recap dodged.",
    "preview dodged.",
    "credits dodged.",
    "skipped it.",
  ],
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

/**
 * Which `done` line each completion surface holds.
 *
 * These are picks, not a rotation: `kannaLine` is pure, so a surface that calls
 * `kannaDoneLine("queued", mode)` always gets the same line — the pick IS the
 * surface's copy, and the constant is what keeps a magic index out of the call
 * sites. Indexes must line up with the `done` pool above.
 */
export const KANNA_DONE_PICKS = {
  saved: 0,
  queued: 1,
  downloaded: 2,
  "skip-intro": 3,
  "skip-recap": 4,
  "skip-preview": 5,
  "skip-credits": 6,
  skipped: 7,
} as const;

export type KannaDoneKind = keyof typeof KANNA_DONE_PICKS;

/** The `done` line for a completion kind, or null when the companion is off. */
export function kannaDoneLine(kind: KannaDoneKind, mode: CompanionMode): string | null {
  if (mode === "off") return null;
  return kannaLine("done", KANNA_DONE_PICKS[kind]);
}

/**
 * The whole render for a plain-text slot — glyph plus line — or null.
 * `StateBlock` draws the glyph separately; status lines, toast text, and the
 * playback trace are single strings, so they need the pair composed here.
 */
export function kannaDoneText(kind: KannaDoneKind, mode: CompanionMode): string | null {
  const line = kannaDoneLine(kind, mode);
  return line === null ? null : `${companionFallbackGlyph()} ${line}`;
}

/**
 * The completion kind for a skipped segment. `PlaybackSkipKind` stays an infra
 * type — this takes the raw string so callers in any layer can map it without
 * pulling the player runtime into a copy decision.
 */
export function kannaDoneKindForSkipKind(kind: string): KannaDoneKind {
  switch (kind) {
    case "intro":
      return "skip-intro";
    case "recap":
      return "skip-recap";
    case "preview":
      return "skip-preview";
    case "credits":
      return "skip-credits";
    default:
      return "skipped";
  }
}
