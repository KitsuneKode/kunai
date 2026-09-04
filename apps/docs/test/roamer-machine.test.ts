import { describe, expect, test } from "bun:test";

import {
  createRoamerState,
  IDLE_TO_SLEEP_MS,
  isResting,
  NOTICE_MS,
  NOTICE_PX,
  pointerIsOver,
  poseForPhase,
  SETTLE_PX,
  SIT_TO_IDLE_MS,
  SPEED_PX_PER_SEC,
  stepRoamer,
  type Point,
  type RoamerState,
} from "../lib/roamer-machine";

/** Advance `ms` in 16ms frames, the way a 60Hz rAF loop would. */
function run(state: RoamerState, ms: number, pointer: Point | null): RoamerState {
  const frame = 16;
  let next = state;
  for (let elapsed = 0; elapsed < ms; elapsed += frame) {
    next = stepRoamer(next, { pointer, dt: frame / 1000 });
  }
  return next;
}

const origin = { x: 100, y: 100 };

describe("noticing", () => {
  test("a small movement is ignored", () => {
    const start = { ...createRoamerState(origin), phase: "sitting" as const };
    const nudge = { x: origin.x + NOTICE_PX - 20, y: origin.y };

    const after = run(start, 2000, nudge);

    expect(after.phase).not.toBe("walking");
    expect(after.pos).toEqual(origin);
  });

  test("a real movement is noticed, then committed to after a beat", () => {
    const start = { ...createRoamerState(origin), phase: "sitting" as const };
    const far = { x: origin.x + 400, y: origin.y };

    // One frame in she has noticed but not decided.
    const noticed = stepRoamer(start, { pointer: far, dt: 0.016 });
    expect(noticed.phase).toBe("noticing");
    expect(noticed.pos).toEqual(origin);

    // She is still deciding well before the beat is up.
    const mid = run(noticed, NOTICE_MS - 120, far);
    expect(mid.phase).toBe("noticing");
    expect(mid.pos).toEqual(origin);

    const committed = run(noticed, NOTICE_MS + 60, far);
    expect(committed.phase).toBe("walking");
  });

  test("a movement that stops before the beat is not acted on", () => {
    const start = { ...createRoamerState(origin), phase: "sitting" as const };
    const far = { x: origin.x + 400, y: origin.y };

    const noticed = stepRoamer(start, { pointer: far, dt: 0.016 });
    expect(noticed.phase).toBe("noticing");

    // The pointer returns to where it was: nothing was meant by it.
    const settled = stepRoamer(noticed, { pointer: origin, dt: 0.016 });
    expect(settled.phase).toBe("sitting");
    expect(settled.pos).toEqual(origin);
  });
});

describe("travel", () => {
  test("settles beside the pointer, not on it", () => {
    const start = { ...createRoamerState(origin), phase: "sitting" as const };
    const far = { x: origin.x + 500, y: origin.y };

    // Long enough to cross 500px at 300px/s and settle, short enough that she
    // has not yet had time to get bored — that transition has its own test.
    const after = run(start, 4000, far);

    expect(after.phase).toBe("sitting");
    const gap = Math.hypot(far.x - after.pos.x, far.y - after.pos.y);
    // Landing on the cursor is the failure this exists to prevent.
    expect(gap).toBeGreaterThan(SETTLE_PX - 2);
    expect(gap).toBeLessThan(SETTLE_PX + 4);
  });

  test("pace is frame-rate independent", () => {
    const start = { ...createRoamerState(origin), phase: "walking" as const };
    const far = { x: origin.x + 2000, y: origin.y };
    const walking: RoamerState = { ...start, committed: far };

    const travel = (frameMs: number) => {
      let s = walking;
      for (let elapsed = 0; elapsed < 1000; elapsed += frameMs) {
        s = stepRoamer(s, { pointer: null, dt: frameMs / 1000 });
      }
      return s.pos.x - origin.x;
    };

    const at30 = travel(33);
    const at60 = travel(16);
    const at144 = travel(7);

    // Same second of walking covers the same ground at any refresh rate.
    expect(Math.abs(at30 - at60)).toBeLessThan(SPEED_PX_PER_SEC * 0.06);
    expect(Math.abs(at60 - at144)).toBeLessThan(SPEED_PX_PER_SEC * 0.06);
  });

  test("a mid-walk retarget changes heading and costs a beat of speed", () => {
    const start = { ...createRoamerState(origin), phase: "walking" as const };
    const right = { x: origin.x + 900, y: origin.y };
    const walking = run({ ...start, committed: right }, 300, null);

    const before = walking.pos.x;
    const left = { x: origin.x - 900, y: origin.y };
    const turned = stepRoamer(walking, { pointer: left, dt: 0.016 });

    expect(turned.committed).toEqual(left);
    expect(turned.turnMs).toBeGreaterThan(0);

    // Through the turn she is slower than she was travelling straight.
    const straight = stepRoamer(walking, { pointer: null, dt: 0.016 });
    const straightStep = Math.abs(straight.pos.x - before);
    const turnedStep = Math.abs(turned.pos.x - before);
    expect(turnedStep).toBeLessThan(straightStep);
  });
});

describe("rest", () => {
  test("arrives watching, gets bored, then sleeps", () => {
    const start = { ...createRoamerState(origin), phase: "sitting" as const };

    expect(start.phase).toBe("sitting");
    expect(poseForPhase("sitting")).toBe("watch");

    const bored = run(start, SIT_TO_IDLE_MS + 100, null);
    expect(bored.phase).toBe("idle");
    expect(poseForPhase("idle")).toBe("idle");

    const asleep = run(bored, IDLE_TO_SLEEP_MS + 100, null);
    expect(asleep.phase).toBe("asleep");
    expect(poseForPhase("asleep")).toBe("nap");
  });

  test("she does not skip straight from arriving to asleep", () => {
    const start = { ...createRoamerState(origin), phase: "sitting" as const };
    // Just short of the boredom threshold she is still watching you.
    const early = run(start, SIT_TO_IDLE_MS - 200, null);
    expect(early.phase).toBe("sitting");
  });

  test("every resting phase is one a line can fire on", () => {
    expect(isResting("sitting")).toBe(true);
    expect(isResting("idle")).toBe(true);
    expect(isResting("asleep")).toBe(true);
    expect(isResting("walking")).toBe(false);
    expect(isResting("noticing")).toBe(false);
  });
});

describe("standing in the way", () => {
  const size = 58;
  const half = size / 2;
  const at = { x: 400, y: 300 };

  test("the pointer is over her inside her box and not outside it", () => {
    expect(pointerIsOver(at, at, size)).toBe(true);
    expect(pointerIsOver(at, { x: at.x + half - 1, y: at.y }, size)).toBe(true);
    expect(pointerIsOver(at, { x: at.x + half + 1, y: at.y }, size)).toBe(false);
    expect(pointerIsOver(at, { x: at.x, y: at.y - half - 1 }, size)).toBe(false);
  });

  test("her corners count, because the browser hit-tests a box", () => {
    // Treating her as a circle would call this "not over her" while the browser
    // was already handing her the click.
    const corner = { x: at.x + half - 1, y: at.y + half - 1 };
    expect(Math.hypot(corner.x - at.x, corner.y - at.y)).toBeGreaterThan(half);
    expect(pointerIsOver(at, corner, size)).toBe(true);
  });

  test("no pointer is not over her", () => {
    expect(pointerIsOver(at, null, size)).toBe(false);
  });

  test("where she settles is close enough to reach back onto her", () => {
    // This is the arithmetic that made the bug real rather than theoretical:
    // she stops SETTLE_PX away, so her near edge is well inside the distance a
    // reader moves to click something near where they stopped.
    const edgeGap = SETTLE_PX - half;
    expect(edgeGap).toBeGreaterThan(0);
    expect(edgeGap).toBeLessThan(NOTICE_PX);

    // A pointer that has drifted onto her has not moved far enough for her to
    // notice and walk away, so she stays there — she cannot solve this by moving.
    const settled = { ...createRoamerState(at), phase: "sitting" as const };
    expect(pointerIsOver(at, at, size)).toBe(true);
    expect(run(settled, 500, at).phase).toBe("sitting");
  });
});
