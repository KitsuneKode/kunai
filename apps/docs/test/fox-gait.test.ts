import { describe, expect, test } from "bun:test";

import {
  advancePhase,
  blendPose,
  eyeOffset,
  type FoxPose,
  gaitPose,
  headingFromMotion,
  legAngles,
  MAX_HEADING_PITCH,
  settlePose,
  SIT_POSE,
  smoothHeading,
  STANDING_POSE,
  strideLength,
  withHeading,
} from "../lib/fox-gait";

describe("legAngles", () => {
  test("a foot reaches forward at touchdown and back at lift-off", () => {
    expect(legAngles(0).hip).toBeLessThan(0);
    expect(legAngles(0.549).hip).toBeGreaterThan(20);
  });

  test("the stance sweep is linear, so a planted foot holds still on the ground", () => {
    const a = legAngles(0.1).hip;
    const b = legAngles(0.2).hip;
    const c = legAngles(0.3).hip;
    expect(b - a).toBeCloseTo(c - b, 6);
  });

  test("the knee folds only during the swing and lands unfolded", () => {
    const planted = legAngles(0.3).knee;
    const midSwing = legAngles(0.775).knee;
    expect(midSwing).toBeGreaterThan(planted + 40);
    // The stride is a loop: the end of the swing meets the start of the stance.
    expect(legAngles(0.999).knee).toBeCloseTo(legAngles(0).knee, 0);
    expect(legAngles(0.999).hip).toBeCloseTo(legAngles(0).hip, 0);
  });

  test("a stride is periodic", () => {
    expect(legAngles(1.25)).toEqual(legAngles(0.25));
    expect(legAngles(-0.75)).toEqual(legAngles(0.25));
  });
});

describe("gaitPose", () => {
  test("diagonal legs move together and opposite legs half a stride apart", () => {
    const pose = gaitPose(0.2);
    // Near front and far hind are the same diagonal; allow for the hind lag.
    expect(Math.abs(pose.frontNear.hip - pose.backFar.hip)).toBeLessThan(5);
    // Near front and far front are on opposite sides of the stride.
    expect(pose.frontNear.hip).not.toBeCloseTo(pose.frontFar.hip, 0);
  });

  test("the body bobs twice per stride, lowest at each footfall", () => {
    const footfall = gaitPose(0).bodyY;
    const between = gaitPose(0.25).bodyY;
    const nextFootfall = gaitPose(0.5).bodyY;
    expect(between).toBeLessThan(footfall);
    expect(footfall).toBeCloseTo(nextFootfall, 6);
  });

  test("is periodic, so wrapping the phase never pops", () => {
    // Wrapping goes through floating-point modulo, so compare to the precision
    // a screen can show rather than bit for bit.
    // `Number.isFinite` is false for anything that is not a number, so strings and
    // nested objects pass through the replacer untouched.
    const round = (pose: FoxPose): FoxPose =>
      JSON.parse(
        JSON.stringify(pose, (_key, v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v)),
      );
    expect(round(gaitPose(1.37))).toEqual(round(gaitPose(0.37)));
  });

  test("never lifts her more than the bob allows", () => {
    for (let step = 0; step < 100; step++) {
      const pose = gaitPose(step / 100);
      expect(pose.bodyY).toBeLessThanOrEqual(0);
      expect(pose.bodyY).toBeGreaterThanOrEqual(-14.0001);
    }
  });
});

describe("blendPose", () => {
  const mid = gaitPose(0.3);

  test("0 is the start pose and 1 is the end pose", () => {
    expect(blendPose(mid, STANDING_POSE, 0)).toEqual(mid);
    expect(blendPose(mid, STANDING_POSE, 1)).toEqual(STANDING_POSE);
  });

  test("clamps, so an overshooting caller cannot fling a joint past its target", () => {
    expect(blendPose(mid, STANDING_POSE, 4)).toEqual(STANDING_POSE);
    expect(blendPose(mid, STANDING_POSE, -2)).toEqual(mid);
  });

  test("halfway lands every leg between the two", () => {
    const half = blendPose(mid, STANDING_POSE, 0.5);
    expect(half.frontNear.hip).toBeCloseTo(mid.frontNear.hip / 2, 6);
  });
});

describe("advancePhase", () => {
  test("a full stride length of travel is exactly one cycle", () => {
    const size = 58;
    expect(advancePhase(0.25, strideLength(size), size)).toBeCloseTo(0.25, 9);
  });

  test("covers distance proportionally, so the legs follow her speed", () => {
    const size = 58;
    const slow = advancePhase(0, 10, size);
    const fast = advancePhase(0, 20, size);
    expect(fast).toBeCloseTo(slow * 2, 9);
  });

  test("holds still when she does, and never runs backwards", () => {
    expect(advancePhase(0.4, 0, 58)).toBe(0.4);
    expect(advancePhase(0.4, -30, 58)).toBe(0.4);
    expect(advancePhase(0.4, Number.NaN, 58)).toBe(0.4);
  });

  test("a bigger fox takes bigger steps", () => {
    expect(strideLength(116)).toBeCloseTo(strideLength(58) * 2, 9);
  });
});

describe("headingFromMotion", () => {
  test("level travel is level, whichever way she faces", () => {
    expect(headingFromMotion(5, 0)).toBeCloseTo(0, 9);
    expect(headingFromMotion(-5, 0)).toBeCloseTo(0, 9);
  });

  test("up the screen is positive and down is negative", () => {
    expect(headingFromMotion(5, -5)).toBeCloseTo(45, 6);
    expect(headingFromMotion(5, 5)).toBeCloseTo(-45, 6);
  });

  test("leaning left or right of vertical gives the same tilt, because facing is a separate flip", () => {
    expect(headingFromMotion(-5, -5)).toBeCloseTo(headingFromMotion(5, -5), 9);
  });

  test("straight up or down is plus or minus 90, and standing still is level", () => {
    expect(headingFromMotion(0, -3)).toBeCloseTo(90, 6);
    expect(headingFromMotion(0, 3)).toBeCloseTo(-90, 6);
    expect(headingFromMotion(0, 0)).toBe(0);
  });
});

describe("smoothHeading", () => {
  test("moves toward the target without overshooting it", () => {
    const next = smoothHeading(0, 40, 0.016);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(40);
  });

  test("two half-steps land where one whole step does, so frame rate does not change the feel", () => {
    const whole = smoothHeading(0, 40, 0.032);
    const halves = smoothHeading(smoothHeading(0, 40, 0.016), 40, 0.016);
    expect(halves).toBeCloseTo(whole, 6);
  });

  test("never moves on a zero or negative delta", () => {
    expect(smoothHeading(10, 40, 0)).toBe(10);
    expect(smoothHeading(10, 40, -1)).toBe(10);
  });
});

describe("withHeading", () => {
  const level = gaitPose(0.3);

  test("a level heading changes nothing", () => {
    expect(withHeading(level, 0)).toEqual(level);
  });

  test("climbing lifts the nose (negative pitch) and descending drops it", () => {
    expect(withHeading(level, 30).bodyPitch).toBeLessThan(level.bodyPitch);
    expect(withHeading(level, -30).bodyPitch).toBeGreaterThan(level.bodyPitch);
  });

  test("the tilt is capped, so a vertical move is a steep scramble and not a rotated sprite", () => {
    const vertical = withHeading(level, 90);
    expect(level.bodyPitch - vertical.bodyPitch).toBeCloseTo(MAX_HEADING_PITCH, 6);
    expect(withHeading(level, 200).bodyPitch).toBeCloseTo(vertical.bodyPitch, 9);
  });

  test("the head leads the body into a climb", () => {
    const climb = withHeading(level, 40);
    expect(level.headPitch - climb.headPitch).toBeGreaterThan(0);
    expect(level.headPitch - climb.headPitch).toBeLessThan(level.bodyPitch - climb.bodyPitch);
  });

  test("on a climb the front paws reach forward and the hind legs drive back", () => {
    const climb = withHeading(level, 45);
    expect(climb.frontNear.hip).toBeLessThan(level.frontNear.hip);
    expect(climb.backNear.hip).toBeGreaterThan(level.backNear.hip);
  });

  test("never alters the stride's own timing: the gait still depends on distance only", () => {
    const a = withHeading(gaitPose(0.2), 30);
    const b = withHeading(gaitPose(0.2), 30);
    expect(a).toEqual(b);
    expect(withHeading(gaitPose(0.2), 30).frontNear.knee).toBe(gaitPose(0.2).frontNear.knee);
  });
});

describe("SIT_POSE", () => {
  test("folds the haunches under and keeps the front legs planted", () => {
    expect(SIT_POSE.backNear.hip).toBeGreaterThan(40);
    expect(SIT_POSE.backNear.knee).toBeGreaterThan(60);
    expect(SIT_POSE.backFar.knee).toBeGreaterThan(60);
    // The front legs prop her chest up — near straight, never folded.
    expect(Math.abs(SIT_POSE.frontNear.hip)).toBeLessThan(15);
    expect(SIT_POSE.frontNear.knee).toBeLessThan(15);
  });

  test("sits low with the tail curled forward and the head held up", () => {
    expect(SIT_POSE.bodyY).toBeGreaterThan(0);
    expect(SIT_POSE.tail).toBeGreaterThan(STANDING_POSE.tail + 20);
    // The torso tilts a little chest-up; the head corrects harder, which is
    // what reads as sitting upright rather than leaning back.
    expect(SIT_POSE.bodyPitch).toBeLessThan(0);
    expect(SIT_POSE.headPitch).toBeLessThan(SIT_POSE.bodyPitch);
  });
});

describe("settlePose", () => {
  test("is deterministic, so the same frame always hangs the same pose", () => {
    expect(settlePose(4.2)).toEqual(settlePose(4.2));
  });

  test("breathes: two moments in the sit are not the same pose", () => {
    expect(settlePose(0.4).bodyY).not.toBe(settlePose(0.9).bodyY);
    expect(settlePose(0.4).tail).not.toBe(settlePose(1.7).tail);
  });

  test("stays a sit — the living channels are small, never a second pose", () => {
    for (let t = 0; t < 40; t += 0.37) {
      const pose = settlePose(t);
      expect(Math.abs(pose.bodyY - SIT_POSE.bodyY)).toBeLessThan(3);
      expect(Math.abs(pose.tail - SIT_POSE.tail)).toBeLessThan(5);
      expect(Math.abs(pose.earNear - SIT_POSE.earNear)).toBeLessThan(3);
      // The haunches stay folded under whatever the breath is doing.
      expect(pose.backNear.knee).toBeGreaterThan(60);
      // And the sit never drifts her above the ground line.
      expect(pose.bodyY).toBeGreaterThan(SIT_POSE.bodyY - 3);
    }
  });
});

describe("eyeOffset", () => {
  test("zero displacement keeps the eye at rest", () => {
    expect(eyeOffset(0, 0)).toEqual({ x: 0, y: 0 });
  });

  test("clamps, so a pointer across the room is a glance, not a crossed eye", () => {
    const far = eyeOffset(10000, -8000);
    expect(Math.abs(far.x)).toBeLessThanOrEqual(4.5);
    expect(Math.abs(far.y)).toBeLessThanOrEqual(2.6);
  });

  test("looks further ahead than behind — a glance is biased to her nose", () => {
    expect(eyeOffset(500, 0).x).toBeGreaterThan(Math.abs(eyeOffset(-500, 0).x));
  });
});
