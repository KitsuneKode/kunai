/**
 * How Kanna decides where to be.
 *
 * The previous model was a mirror: her position was a function of the pointer,
 * retargeted every move, so she read as software following a cursor. This one
 * gives her attention instead — she has to notice, decide, travel, and settle,
 * and she can be wrong about whether a movement was meant for her. The
 * reference is `oneko`, the X11 cat that chases the pointer and sleeps once it
 * catches up.
 *
 * Pure and clock-injected on purpose: every rule here is a timing rule, and a
 * test that needs a real sleep to prove one is a test that will flake. Callers
 * pass a delta; nothing in this file reads a clock or schedules anything.
 */

export type RoamerPhase = "noticing" | "walking" | "sitting" | "idle" | "asleep";

export type Point = { readonly x: number; readonly y: number };

export type RoamerState = {
  readonly pos: Point;
  /** Where she decided to go. Not the pointer — see `SETTLE_PX`. */
  readonly committed: Point;
  readonly phase: RoamerPhase;
  readonly facing: "left" | "right";
  /** Milliseconds spent in the current resting phase. */
  readonly restMs: number;
  /** Milliseconds since she first noticed the movement she has not acted on. */
  readonly noticeMs: number;
  /** Milliseconds of reduced speed left after a mid-walk change of heading. */
  readonly turnMs: number;
};

/**
 * How far the pointer must move before she treats it as meant for her.
 *
 * The whole difference between an animal and a cursor decoration. Below this
 * she ignores you, which is what makes her look like she has her own opinion
 * about whether something happened.
 */
export const NOTICE_PX = 90;
/** She notices, then decides. Without the beat she reads as reflex, not attention. */
export const NOTICE_MS = 350;
/**
 * She settles this far from the pointer, on the side she approached from.
 *
 * The single most important number here: anything that lands *under* the cursor
 * reads as a cursor decoration rather than a companion standing next to you.
 */
export const SETTLE_PX = 70;
/** Pixels per second. Per-second with a delta so pace holds at 30, 60 and 144Hz. */
export const SPEED_PX_PER_SEC = 300;
/** Eases in over this distance so she arrives rather than stopping dead. */
export const EASE_PX = 90;
/** Slowest she travels while still closing, as a fraction of full speed. */
export const MIN_SPEED_FACTOR = 0.25;
/** A mid-walk retarget costs a beat: animals do not pivot instantly. */
export const TURN_MS = 260;
export const TURN_FACTOR = 0.35;
/** Arrived → looking at you. Then she loses interest. */
export const SIT_TO_IDLE_MS = 6000;
/** Bored → curled up. The middle phase is what makes her read as bored, not off. */
export const IDLE_TO_SLEEP_MS = 20000;
/** Only commit to a direction on real horizontal travel, so she does not flip about. */
const FACING_DEADBAND_PX = 10;

export function createRoamerState(at: Point): RoamerState {
  return {
    pos: at,
    committed: at,
    phase: "asleep",
    facing: "right",
    restMs: 0,
    noticeMs: 0,
    turnMs: 0,
  };
}

/** The pose each phase draws. `noticing` is a beat, so it holds the resting still. */
export function poseForPhase(phase: RoamerPhase): "go" | "watch" | "idle" | "nap" {
  if (phase === "walking") return "go";
  if (phase === "sitting") return "watch";
  if (phase === "asleep") return "nap";
  return "idle";
}

/** True while she is settled enough that an unprompted line fits what she is doing. */
export function isResting(phase: RoamerPhase): boolean {
  return phase === "sitting" || phase === "idle" || phase === "asleep";
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export type RoamerStep = {
  /** Pointer position, or null when it has left the surface. */
  readonly pointer: Point | null;
  /** Seconds since the last step. Callers clamp; a backgrounded tab returns a huge delta. */
  readonly dt: number;
};

/**
 * Advance one frame.
 *
 * Returns a new state; never mutates. The phase order is deliberate — noticing
 * is evaluated before movement so a retarget lands on the same frame it was
 * seen, and resting decay is evaluated last so an arrival does not immediately
 * age into the next phase.
 */
export function stepRoamer(state: RoamerState, { pointer, dt }: RoamerStep): RoamerState {
  const ms = dt * 1000;
  let { pos, committed, phase, facing, restMs, noticeMs, turnMs } = state;
  turnMs = Math.max(0, turnMs - ms);

  if (pointer) {
    const moved = distance(committed, pointer);

    if (moved > NOTICE_PX) {
      if (phase === "walking") {
        // Mid-walk recalibration. She re-targets rather than finishing a stale
        // walk, but pays for the change of heading instead of snapping onto it.
        committed = pointer;
        turnMs = TURN_MS;
      } else if (phase === "noticing") {
        noticeMs += ms;
        if (noticeMs >= NOTICE_MS) {
          committed = pointer;
          phase = "walking";
          noticeMs = 0;
        }
      } else {
        phase = "noticing";
        noticeMs = 0;
      }
    } else if (phase === "noticing") {
      // The movement stopped before she committed: it was not meant for her.
      phase = "sitting";
      noticeMs = 0;
    }
  }

  if (phase === "walking") {
    const gap = distance(pos, committed);
    const remaining = Math.max(0, gap - SETTLE_PX);

    if (remaining > 1 && gap > 0) {
      const ease = MIN_SPEED_FACTOR + (1 - MIN_SPEED_FACTOR) * Math.min(1, remaining / EASE_PX);
      const turn = turnMs > 0 ? TURN_FACTOR : 1;
      const travel = Math.min(SPEED_PX_PER_SEC * ease * turn * dt, remaining);
      const dx = (committed.x - pos.x) / gap;
      const dy = (committed.y - pos.y) / gap;
      pos = { x: pos.x + dx * travel, y: pos.y + dy * travel };
      if (Math.abs(committed.x - pos.x) > FACING_DEADBAND_PX) {
        facing = committed.x > pos.x ? "right" : "left";
      }
    } else {
      phase = "sitting";
      restMs = 0;
    }
    return { pos, committed, phase, facing, restMs, noticeMs, turnMs };
  }

  if (phase === "sitting" || phase === "idle") {
    restMs += ms;
    if (phase === "sitting" && restMs >= SIT_TO_IDLE_MS) {
      phase = "idle";
      restMs = 0;
    } else if (phase === "idle" && restMs >= IDLE_TO_SLEEP_MS) {
      phase = "asleep";
      restMs = 0;
    }
  }

  return { pos, committed, phase, facing, restMs, noticeMs, turnMs };
}
