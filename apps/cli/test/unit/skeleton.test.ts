import { expect, test } from "bun:test";

import { barTones } from "@/app-shell/skeleton";

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
