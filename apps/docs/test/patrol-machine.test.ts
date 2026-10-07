import { describe, expect, test } from "bun:test";

import {
  chooseTarget,
  createPatrolState,
  MIN_HOP_PX,
  PATROL_SPEED_PX_PER_SEC,
  PAUSE_RANGE_MS,
  type PatrolState,
  stepPatrol,
} from "../lib/patrol-machine";

const LANE = 1000;
const SIZE = 56;
const constant = (value: number) => () => value;

function walking(x: number, target: number): PatrolState {
  return {
    x,
    target,
    phase: "walking",
    pauseMs: 0,
    facing: target >= x ? "right" : "left",
  };
}

describe("stepPatrol: walking", () => {
  test("covers speed times dt, so pace holds at any frame rate", () => {
    const next = stepPatrol(walking(100, 900), {
      dt: 0.5,
      lane: LANE,
      size: SIZE,
      rand: constant(0),
    });
    expect(next.x).toBeCloseTo(100 + PATROL_SPEED_PX_PER_SEC * 0.5, 6);
    expect(next.phase).toBe("walking");
  });

  test("walks left when the stop is to the left", () => {
    const next = stepPatrol(walking(500, 100), {
      dt: 0.1,
      lane: LANE,
      size: SIZE,
      rand: constant(0),
    });
    expect(next.x).toBeLessThan(500);
  });

  test("arrives exactly on the stop, never past it, and starts standing", () => {
    const next = stepPatrol(walking(100, 102), {
      dt: 1,
      lane: LANE,
      size: SIZE,
      rand: constant(0.5),
    });
    expect(next.x).toBe(102);
    expect(next.phase).toBe("pausing");
  });

  test("the pause is drawn from the range", () => {
    const [low, high] = PAUSE_RANGE_MS;
    const short = stepPatrol(walking(100, 100), {
      dt: 1,
      lane: LANE,
      size: SIZE,
      rand: constant(0),
    });
    const long = stepPatrol(walking(100, 100), {
      dt: 1,
      lane: LANE,
      size: SIZE,
      rand: constant(0.999999),
    });
    expect(short.pauseMs).toBeCloseTo(low, 3);
    expect(long.pauseMs).toBeLessThan(high);
    expect(long.pauseMs).toBeGreaterThan(high - 10);
  });
});

describe("stepPatrol: pausing", () => {
  const standing: PatrolState = {
    x: 300,
    target: 300,
    phase: "pausing",
    pauseMs: 1000,
    facing: "right",
  };

  test("stays put while the pause runs down", () => {
    const next = stepPatrol(standing, { dt: 0.4, lane: LANE, size: SIZE, rand: constant(0.9) });
    expect(next.phase).toBe("pausing");
    expect(next.x).toBe(300);
    expect(next.pauseMs).toBeCloseTo(600, 6);
  });

  test("picks a stop and faces it when the pause ends", () => {
    const next = stepPatrol(
      { ...standing, pauseMs: 10 },
      { dt: 0.1, lane: LANE, size: SIZE, rand: constant(0.9) },
    );
    expect(next.phase).toBe("walking");
    expect(next.target).toBeGreaterThan(300);
    expect(next.facing).toBe("right");

    const left = stepPatrol(
      { ...standing, pauseMs: 10 },
      { dt: 0.1, lane: LANE, size: SIZE, rand: constant(0.05) },
    );
    expect(left.target).toBeLessThan(300);
    expect(left.facing).toBe("left");
  });
});

describe("chooseTarget", () => {
  test("never stays within a shuffle of where she already is", () => {
    for (let step = 0; step < 50; step++) {
      const from = 400;
      const target = chooseTarget(from, LANE, SIZE, constant(step / 50));
      expect(Math.abs(target - from)).toBeGreaterThanOrEqual(MIN_HOP_PX);
    }
  });

  test("stays on the lane, with the figure's own width reserved", () => {
    for (let step = 0; step <= 20; step++) {
      const target = chooseTarget(0, LANE, SIZE, constant(step / 20));
      expect(target).toBeGreaterThanOrEqual(0);
      expect(target).toBeLessThanOrEqual(LANE - SIZE);
    }
  });

  test("a lane too short for a real hop still returns a stop on the lane", () => {
    const target = chooseTarget(0, 120, SIZE, constant(0.1));
    expect(target).toBeGreaterThanOrEqual(0);
    expect(target).toBeLessThanOrEqual(64);
  });
});

describe("stepPatrol: resize", () => {
  test("a lane that shrinks under her pulls her back inside it", () => {
    const stranded = walking(900, 950);
    const next = stepPatrol(stranded, { dt: 0.016, lane: 400, size: SIZE, rand: constant(0.5) });
    expect(next.x).toBeLessThanOrEqual(400 - SIZE);
  });

  test("a fresh state is standing and ready to choose", () => {
    const state = createPatrolState(10);
    expect(state.phase).toBe("pausing");
    expect(state.pauseMs).toBe(0);
  });
});
