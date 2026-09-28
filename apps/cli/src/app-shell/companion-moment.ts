import type { CompanionPose } from "./companion-policy";

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
  /** A stream resolved; the handoff to mpv is next. */
  | "handoff"
  /** Playback is running. */
  | "watching"
  /** Something failed and the surface has nothing else to show. */
  | "trouble"
  /** On the way out. */
  | "farewell";

/**
 * The pose each moment draws.
 *
 * `seeking` draws `go` rather than `seek`: the sheet's `seek` reads as a low
 * idle and is nearly indistinguishable from `idle` at companion size, so it is
 * held back for a redraw. `go` is the trotting carry pose, which reads as
 * motion — the right idea, and real art. Swap it here when the redraw lands;
 * nothing else has to change.
 */
const POSE_BY_MOMENT = {
  setup: "wait",
  settled: "idle",
  seeking: "go",
  handoff: "go",
  watching: "watch",
  trouble: "oops",
  farewell: "nap",
} as const satisfies Record<CompanionMoment, CompanionPose>;

export const COMPANION_MOMENTS = Object.keys(POSE_BY_MOMENT) as readonly CompanionMoment[];

export function poseForMoment(moment: CompanionMoment): CompanionPose {
  return POSE_BY_MOMENT[moment];
}

/**
 * The moment a loading surface is in, or `null` for no companion.
 *
 * `null` is a real answer and the common one. The rule it encodes: **the
 * companion never competes with content artwork.** Where a poster is shown, the
 * poster wins — it is the thing the reader actually came for, and two images on
 * one surface is how the social card ended up drawing its type row across her
 * face. She fills the empty frame, she does not crowd a full one.
 */
export function momentForLoading({
  operation,
  stage,
  hasPoster,
  failed,
}: {
  readonly operation: "resolving" | "playing" | "loading";
  readonly stage?: string;
  readonly hasPoster: boolean;
  readonly failed: boolean;
}): CompanionMoment | null {
  // Failure leads. It is the one moment worth crowding a poster for — the
  // surface is telling someone something went wrong, and that outranks artwork.
  if (failed) return "trouble";
  if (hasPoster) return null;
  // The last stage before mpv takes the terminal: the stream is found and being
  // handed over. It is brief, which is exactly why it earns the carry pose.
  if (stage === "starting-playback") return "handoff";
  if (operation === "resolving") return "seeking";
  if (operation === "playing") return "watching";
  // `loading` is the generic case and says nothing about what is happening, so
  // there is no pose that would mean anything on it.
  return null;
}
