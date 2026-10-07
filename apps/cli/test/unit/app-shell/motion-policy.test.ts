import { describe, expect, test } from "bun:test";

import { reducedMotionEnabled } from "@/app-shell/motion-policy";

describe("reducedMotionEnabled", () => {
  test("is off when neither variable is set", () => {
    expect(reducedMotionEnabled({})).toBe(false);
  });

  test.each(["1", "true", "yes", "on", "anything"])(
    "KUNAI_REDUCED_MOTION=%s asks for it",
    (value) => {
      expect(reducedMotionEnabled({ KUNAI_REDUCED_MOTION: value })).toBe(true);
    },
  );

  test.each(["", "0", "false", "off", "no", " 0 ", "FALSE"])(
    "KUNAI_REDUCED_MOTION=%j does not ask for it",
    (value) => {
      expect(reducedMotionEnabled({ KUNAI_REDUCED_MOTION: value })).toBe(false);
    },
  );

  test("the cross-tool NO_MOTION is honored with the same rules", () => {
    expect(reducedMotionEnabled({ NO_MOTION: "1" })).toBe(true);
    expect(reducedMotionEnabled({ NO_MOTION: "0" })).toBe(false);
  });

  test("either variable is enough, and one saying 0 does not cancel the other", () => {
    expect(reducedMotionEnabled({ KUNAI_REDUCED_MOTION: "0", NO_MOTION: "1" })).toBe(true);
    expect(reducedMotionEnabled({ KUNAI_REDUCED_MOTION: "1", NO_MOTION: "0" })).toBe(true);
  });
});
