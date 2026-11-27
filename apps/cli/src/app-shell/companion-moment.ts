import type { CompanionMode, CompanionPose } from "./companion-policy";
import type { KannaMoment } from "./kanna-voice";

/**
 * What the session is doing, in the only terms the companion cares about.
 *
 * This exists because the alternative does not survive contact with the shell.
 * Sixteen surfaces mount a `StateBlock`; three of them live in shells that
 * render three each. If every surface decided for itself whether to draw a
 * companion, every one of them would also be deciding it owned the single
 * Kitty placement slot — and `registerKittyPlacement` deletes the previous
 * image when a different one claims a slot, so two concurrent owners erase each
 * other on every render. That is not hypothetical: the setup wizard shipped
 * exactly that bug, and it stayed invisible until the two were given separate
 * slots and the duplicate became visible instead.
 *
 * So the decision moves here. A surface reports what is happening; one host
 * draws at most one companion. Adding a moment cannot collide with an existing
 * one, because there is only ever one drawer.
 */
export type CompanionMoment =
  /** The setup wizard, mid-flow. */
  | "setup"
  /** The setup summary — the waiting is over. */
  | "settled"
  /** Providers are racing for a stream. */
  | "seeking"
  /** One provider died and the race moved on to the next. */
  | "rerouting"
  /** The race has run past the stall threshold. */
  | "dragging"
  /** A stream resolved; the handoff to the player is next. */
  | "handoff"
  /** The same handoff, reached only after a provider had failed. */
  | "recovered"
  /** Playback is running. */
  | "watching"
  /** The resolve failed and the surface is offering ways out. */
  | "stuck"
  /** An error surface that already says so in words of its own. */
  | "trouble"
  /** A search came back with nothing. */
  | "missing"
  /** A bare surface — nothing has been asked yet. */
  | "empty"
  /** On the way out. */
  | "farewell";

/**
 * The pose each moment draws. Every pose appears here at least once: a pose no
 * moment reaches is art embedded in the binary that no code path can draw.
 *
 * The hunt is three of them. `seek` is the wait — she leans in while providers
 * race, and keeps leaning when one dies or the race drags. `go` is the single
 * beat where the stream is found and carried to the player. `oops` is the
 * failure. She is drawn for the wait and for the failure, never for success.
 *
 * The two empty states differ on purpose. `missing` is a search that found
 * nothing, so she peeks over the edge at where the results should be; `empty`
 * is a frame nothing has been asked of yet, so she is asleep until it is.
 */
const POSE_BY_MOMENT = {
  setup: "wait",
  settled: "idle",
  seeking: "seek",
  rerouting: "seek",
  dragging: "seek",
  handoff: "go",
  recovered: "go",
  watching: "watch",
  stuck: "oops",
  trouble: "oops",
  missing: "peek",
  empty: "nap",
  farewell: "nap",
} as const satisfies Record<CompanionMoment, CompanionPose>;

/**
 * What she says at each moment, or `null` where she says nothing.
 *
 * The silences are decisions. `watching` is someone watching: a line there is a
 * line in the way. `settled` already carries a summary. And `trouble`,
 * `missing` and `empty` sit beside a `StateBlock`, which speaks for itself — a
 * second line under it would be the same thought twice.
 */
const VOICE_BY_MOMENT = {
  setup: "first-run",
  settled: null,
  seeking: "resolving",
  rerouting: "dead-end",
  dragging: "slow",
  handoff: "handoff",
  recovered: "found",
  watching: null,
  stuck: "error",
  trouble: null,
  missing: null,
  empty: null,
  farewell: "goodbye",
} as const satisfies Record<CompanionMoment, KannaMoment | null>;

export const COMPANION_MOMENTS = Object.keys(POSE_BY_MOMENT) as readonly CompanionMoment[];

export function poseForMoment(moment: CompanionMoment): CompanionPose {
  return POSE_BY_MOMENT[moment];
}

export function voiceForMoment(moment: CompanionMoment): KannaMoment | null {
  return VOICE_BY_MOMENT[moment];
}

/**
 * A moment, and whether the picture may be drawn for it.
 *
 * The two travel together because they are decided together. Where a poster is
 * on screen the picture stands down — but the line is one dim row, competes
 * with nothing, and is the tier every terminal gets, so it stays.
 */
export type CompanionCue = {
  readonly moment: CompanionMoment;
  readonly picture: boolean;
};

/** Seconds into a resolve after which the shell itself says it is slow. */
const STALL_THRESHOLD_SECONDS = 10;

/**
 * The cue a loading surface is in, or `null` for no companion at all.
 *
 * The rule the picture follows: **the companion never competes with content
 * artwork.** Where a poster is shown, the poster wins — it is the thing the
 * reader actually came for, and two images on one surface is how the social
 * card ended up drawing its type row across her face. She fills the empty
 * frame, she does not crowd a full one.
 *
 * `issue` and `elapsed` are the shell's own state — the issue it is already
 * displaying, the seconds it is already counting — so each change of moment
 * here is a transition the surface went through, not a timer of hers.
 */
export function momentForLoading({
  operation,
  stage,
  hasPoster,
  failed,
  issue,
  elapsed = 0,
}: {
  readonly operation: "resolving" | "playing" | "loading";
  readonly stage?: string;
  readonly hasPoster: boolean;
  readonly failed: boolean;
  /** The problem the shell is currently reporting, if any. */
  readonly issue?: string | null;
  /** Seconds this wait has run. */
  readonly elapsed?: number;
}): CompanionCue | null {
  // Failure leads. It is the one moment worth crowding a poster for — the
  // surface is telling someone something went wrong, and that outranks artwork.
  if (failed) return { moment: "stuck", picture: true };
  const picture = !hasPoster;
  // The last stage before the player takes the terminal: the stream is found
  // and being handed over. It is brief, which is exactly why it earns the carry
  // pose. An issue still on screen here means it took a second provider.
  if (stage === "starting-playback") {
    return { moment: issue ? "recovered" : "handoff", picture };
  }
  if (operation === "resolving") {
    if (issue) return { moment: "rerouting", picture };
    if (elapsed >= STALL_THRESHOLD_SECONDS) return { moment: "dragging", picture };
    return { moment: "seeking", picture };
  }
  // Someone is watching. No line, and no picture where there is a poster.
  if (operation === "playing") return picture ? { moment: "watching", picture } : null;
  // `loading` is the generic case and says nothing about what is happening, so
  // there is no pose that would mean anything on it.
  return null;
}

/**
 * The moment a bare browse surface is in, or `null` for no companion.
 *
 * Same rule as `momentForLoading` — she fills the empty frame, she does not
 * crowd a full one — plus two narrower gates this surface needs:
 *
 * - Glyph terminals already hear her here: the `StateBlock` voice line carries
 *   a 🦊 of its own. A second lone glyph beside it reads as a stray emoji, so
 *   only the real illustration earns the frame.
 * - Ultra-compact viewports have no spare rows for her; the voice line still
 *   reaches them.
 */
export function momentForBrowseEmpty({
  kind,
  hasArtwork,
  ultraCompact,
  mode,
}: {
  /** `no-results` is a search that found nothing; `empty` is nothing asked yet. */
  readonly kind: "empty" | "no-results" | "error";
  readonly hasArtwork: boolean;
  readonly ultraCompact: boolean;
  readonly mode: CompanionMode;
}): CompanionMoment | null {
  if (mode !== "graphics" || ultraCompact) return null;
  // Failure leads, same as loading: an error surface is telling someone
  // something went wrong, and that outranks an empty frame.
  if (kind === "error") return "trouble";
  if (hasArtwork) return null;
  return kind === "no-results" ? "missing" : "empty";
}
