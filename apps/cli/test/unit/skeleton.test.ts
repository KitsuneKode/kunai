import { expect, test, spyOn } from "bun:test";

import { SkeletonRows, barTones } from "@/app-shell/skeleton";
import React from "react";

import { render } from "../harness/render-capture";

test("barTones lights a peak at the highlight with a falloff", () => {
  const tones = barTones(8, 3);
  expect(tones[3]).toBe("peak");
  expect(tones[2]).toBe("near");
  expect(tones[4]).toBe("near");
  expect(tones[0]).toBe("base");
  expect(tones[7]).toBe("base");
});

test("barTones is all base when the highlight is off-screen (rest phase)", () => {
  const tones = barTones(6, 20);
  expect(tones.every((t) => t === "base")).toBe(true);
});

test("barTones returns exactly width cells", () => {
  expect(barTones(12, 5)).toHaveLength(12);
  expect(barTones(0, 0)).toHaveLength(0);
});

test("skeleton does not schedule animation under reduced motion", () => {
  const saved = { reduced: process.env.KUNAI_REDUCED_MOTION, noMotion: process.env.NO_MOTION };
  const interval = spyOn(globalThis, "setInterval");
  delete process.env.NO_MOTION;
  try {
    for (const reduced of [false, true]) {
      interval.mockClear();
      process.env.KUNAI_REDUCED_MOTION = reduced ? "1" : "0";
      const handle = render(React.createElement(SkeletonRows));
      try {
        expect(interval.mock.calls.some(([, ms]) => ms === 90)).toBe(!reduced);
      } finally {
        handle.unmount();
      }
    }
  } finally {
    interval.mockRestore();
    if (saved.reduced === undefined) delete process.env.KUNAI_REDUCED_MOTION;
    else process.env.KUNAI_REDUCED_MOTION = saved.reduced;
    if (saved.noMotion === undefined) delete process.env.NO_MOTION;
    else process.env.NO_MOTION = saved.noMotion;
  }
});
