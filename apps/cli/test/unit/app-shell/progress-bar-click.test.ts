import { expect, test } from "bun:test";

import { progressBarValueFromClick } from "@/app-shell/primitives/ProgressBar";

test("progress bar clicks map measured terminal columns to playback time", () => {
  const bounds = { x: 10, y: 4, width: 11, height: 1 };
  expect(progressBarValueFromClick(11, 5, bounds, 100)).toBe(0);
  expect(progressBarValueFromClick(16, 5, bounds, 100)).toBe(50);
  expect(progressBarValueFromClick(21, 5, bounds, 100)).toBe(100);
});

test("progress bar clicks outside the measured row and columns are ignored", () => {
  const bounds = { x: 10, y: 4, width: 11, height: 1 };
  expect(progressBarValueFromClick(10, 5, bounds, 100)).toBeNull();
  expect(progressBarValueFromClick(22, 5, bounds, 100)).toBeNull();
  expect(progressBarValueFromClick(16, 4, bounds, 100)).toBeNull();
});
