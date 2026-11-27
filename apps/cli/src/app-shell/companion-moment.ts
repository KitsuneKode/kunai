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
  /** A stream resolved and is being carried to the player. */
  | "carrying"
  /** The same carry, reached only after a provider had failed. */
  | "recovered"
  /** The player has the stream and is coming up; nothing left to do but watch. */
  | "handoff"
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
 * The hunt is four of them, in order. `seek` is the wait — she leans in while
 * providers race, and keeps leaning when one dies or the race drags. `go` is
 * the single beat where the stream is found and carried to the player. `watch`
 * is the last wait: the player has it, and she sits back while it comes up.
 * `oops` is the failure.
 *
 * She is drawn for the waits and for the failure, never for success. Once
 * playback is running there is no moment at all — the terminal is a control
 * surface for something being watched somewhere else, and she is out of frame.
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
  carrying: "go",
  recovered: "go",
  handoff: "watch",
  stuck: "oops",
  trouble: "oops",
  missing: "peek",
  empty: "nap",
  farewell: "nap",
} as const satisfies Record<CompanionMoment, CompanionPose>;

/**
 * What she says at each moment, or `null` where she says nothing.
 *
 * The silences are decisions. `carrying` is one beat between two lines, and a
 * healthy session is held to four of them. `settled` already carries a summary.
 * And `trouble`, `missing` and `empty` sit beside a `StateBlock`, which speaks
 * for itself — a second line under it would be the same thought twice.
 */
const VOICE_BY_MOMENT = {
  setup: "first-run",
  settled: null,
  seeking: "resolving",
  rerouting: "dead-end",
  dragging: "slow",
  carrying: null,
  recovered: "found",
  handoff: "handoff",
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

/**
 * Seconds into a resolve after which the shell itself calls the source slow
 * (`SLOW_RESOLVE_SECONDS` in `provider-resolve-user-state.ts`). She says it is
 * dragging at the same moment the footer does, not before.
 */
const STALL_THRESHOLD_SECONDS = 20;

/**
 * The shortest terminal the loading surface can give her four rows on. Below
 * it the stage rail and the footer already fill the screen, and a picture
 * pushes something that matters off the top.
 */
const LOADING_PICTURE_MIN_ROWS = 30;

/** Providers are being tried: the wait she leans into. */
const RACE_STAGES: ReadonlySet<string> = new Set(["finding-stream", "preparing-provider"]);

/**
 * The cue a loading surface is in, or `null` for no companion at all.
 *
 * The rule the picture follows: **the companion never competes with content
 * artwork.** Where a poster is shown, the poster wins — it is the thing the
 * reader actually came for, and two images on one surface is how the social
 * card ended up drawing its type row across her face. She fills the empty
 * frame, she does not crowd a full one.
 *
 * `issue` and `elapsed` are the shell's own state — the structured problem it
 * is already reporting, the seconds it is already counting — so each change of
 * moment here is a transition the surface went through, not a timer of hers.
 */
export function momentForLoading({
  operation,
  stage,
  hasPoster,
  rows = LOADING_PICTURE_MIN_ROWS,
  failed,
  issue,
  elapsed = 0,
}: {
  readonly operation: "resolving" | "playing" | "loading";
  readonly stage?: string;
  readonly hasPoster: boolean;
  /** Terminal height. A short one keeps the line and gives up the picture. */
  readonly rows?: number;
  readonly failed: boolean;
  /** The structured problem the shell is reporting, if any — never advisory prose. */
  readonly issue?: string | null;
  /** Seconds this wait has run. */
  readonly elapsed?: number;
}): CompanionCue | null {
  // Failure leads. It is the one moment worth crowding a poster for — the
  // surface is telling someone something went wrong, and that outranks artwork.
  const roomy = rows >= LOADING_PICTURE_MIN_ROWS;
  if (failed) return { moment: "stuck", picture: roomy };
  const picture = !hasPoster && roomy;
  // Someone is watching, and it worked. Neither is a moment for her.
  if (operation === "playing") return null;
  // The stage is what says where a bootstrap is, not the operation: the shell
  // reports `loading` for most of a resolve, and only the stage tells the race
  // from the carry from the handoff.
  if (stage === "starting-playback") return { moment: "handoff", picture };
  // The stream is found and being carried to the player. It is brief, which is
  // exactly why it earns the carry pose. A problem still on screen here means
  // it took a second provider to get one, and that is the one time she says so.
  if (stage === "preparing-player") return { moment: issue ? "recovered" : "carrying", picture };
  if (RACE_STAGES.has(stage ?? "") || operation === "resolving") {
    if (issue) return { moment: "rerouting", picture };
    if (elapsed >= STALL_THRESHOLD_SECONDS) return { moment: "dragging", picture };
    return { moment: "seeking", picture };
  }
  // A `loading` with no stage says nothing about what is happening, so there is
  // no pose that would mean anything on it.
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
 * - A cramped viewport has no spare rows for her. On the default 80x24 the
 *   search box, the rules and the footer already use the screen, and four more
 *   rows push the very message she is peeking over off the top. The voice line
 *   still reaches it.
 */
export function momentForBrowseEmpty({
  kind,
  hasArtwork,
  cramped,
  mode,
}: {
  /** `no-results` is a search that found nothing; `empty` is nothing asked yet. */
  readonly kind: "empty" | "no-results" | "error";
  readonly hasArtwork: boolean;
  /** The viewport is too short to spare her rows. */
  readonly cramped: boolean;
  readonly mode: CompanionMode;
}): CompanionMoment | null {
  if (mode !== "graphics" || cramped) return null;
  // Failure leads, same as loading: an error surface is telling someone
  // something went wrong, and that outranks an empty frame.
  if (kind === "error") return "trouble";
  if (hasArtwork) return null;
  return kind === "no-results" ? "missing" : "empty";
}
