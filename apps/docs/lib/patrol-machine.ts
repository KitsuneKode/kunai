/**
 * Where Kanna goes when she is pacing a line and nobody is steering her.
 *
 * The roaming fox (`roamer-machine.ts`) follows the pointer; this one has no
 * input at all. She picks a spot on a horizontal lane, walks there, stands for
 * a while, and picks another. Pure and clock-injected for the same reason as
 * her sibling: every rule is a timing rule, and a rule that needs a real sleep
 * to prove is a rule that will flake. The random source is injected too, so a
 * test can choose "the next stop is far left" instead of hoping for it.
 */

export type PatrolPhase = "walking" | "pausing";

export type PatrolState = {
  /** Left edge of the figure along the lane, in pixels. */
  readonly x: number;
  readonly target: number;
  readonly phase: PatrolPhase;
  /** Milliseconds left to stand before choosing another stop. */
  readonly pauseMs: number;
  readonly facing: "left" | "right";
};

/** An unhurried walk. The roaming fox is brisk because she is chasing something. */
export const PATROL_SPEED_PX_PER_SEC = 64;
/** How long she stands at each stop, drawn uniformly from this range. */
export const PAUSE_RANGE_MS = [2400, 6800] as const;
/** The shortest hop worth walking. Closer than this reads as shuffling in place. */
export const MIN_HOP_PX = 140;

export type PatrolStep = {
  readonly dt: number;
  /** Width of the lane the figure walks along. */
  readonly lane: number;
  /** Width of the figure itself, so it never walks off the right end. */
  readonly size: number;
  /** Uniform random in [0, 1). Injected so a test can pick the outcome. */
  readonly rand: () => number;
};

function maxX(lane: number, size: number): number {
  return Math.max(0, lane - size);
}

export function createPatrolState(x: number): PatrolState {
  return { x, target: x, phase: "pausing", pauseMs: 0, facing: "right" };
}

/**
 * Choose the next stop: somewhere on the lane at least `MIN_HOP_PX` away.
 *
 * Falls back to the far end when the lane is too short to offer a real hop, so
 * a narrow screen still gets a walk rather than a figure that never moves.
 */
export function chooseTarget(from: number, lane: number, size: number, rand: () => number): number {
  const limit = maxX(lane, size);
  const candidate = rand() * limit;
  if (Math.abs(candidate - from) >= MIN_HOP_PX) return candidate;
  // Too close: go to whichever end is further away.
  const farEnd = from < limit / 2 ? limit : 0;
  return Math.abs(farEnd - from) >= MIN_HOP_PX ? farEnd : candidate;
}

/** Advance one frame. Returns a new state; never mutates. */
export function stepPatrol(state: PatrolState, { dt, lane, size, rand }: PatrolStep): PatrolState {
  const limit = maxX(lane, size);
  // A resize can strand her past the new right end. Pull her back rather than
  // letting her stand in the margin until the next stop.
  const x = Math.min(Math.max(state.x, 0), limit);

  if (state.phase === "pausing") {
    const pauseMs = state.pauseMs - dt * 1000;
    if (pauseMs > 0) return { ...state, x, pauseMs };
    const target = chooseTarget(x, lane, size, rand);
    return {
      x,
      target,
      phase: "walking",
      pauseMs: 0,
      facing: target >= x ? "right" : "left",
    };
  }

  // The stop she was heading for may now be off the lane too; head for the
  // nearest point that still is.
  const target = Math.min(Math.max(state.target, 0), limit);
  const gap = target - x;
  const travel = PATROL_SPEED_PX_PER_SEC * dt;
  if (Math.abs(gap) <= travel) {
    const [low, high] = PAUSE_RANGE_MS;
    return {
      x: target,
      target,
      phase: "pausing",
      pauseMs: low + rand() * (high - low),
      facing: state.facing,
    };
  }
  return { ...state, x: x + Math.sign(gap) * travel, target };
}
