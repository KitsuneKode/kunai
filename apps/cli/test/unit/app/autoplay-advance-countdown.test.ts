import { expect, test } from "bun:test";

import { runAutoplayAdvanceCountdown } from "@/app/autoplay-advance-countdown";

test("runAutoplayAdvanceCountdown ticks down and continues by default", async () => {
  const ticks: number[] = [];

  const result = await runAutoplayAdvanceCountdown({
    seconds: 3,
    sleep: async () => {},
    onTick: (remaining) => ticks.push(remaining),
    isCancelled: () => false,
  });

  expect(result).toBe("continue");
  expect(ticks).toEqual([3, 2, 1]);
});

test("runAutoplayAdvanceCountdown cancels when autoplay is paused during the countdown", async () => {
  const ticks: number[] = [];

  const result = await runAutoplayAdvanceCountdown({
    seconds: 5,
    sleep: async () => {},
    onTick: (remaining) => ticks.push(remaining),
    isCancelled: () => remainingCancelledAfterFirstTick(ticks),
  });

  expect(result).toBe("cancelled");
  expect(ticks).toEqual([5]);
});

test("runAutoplayAdvanceCountdown can be skipped by an explicit user action", async () => {
  const ticks: number[] = [];

  const result = await runAutoplayAdvanceCountdown({
    seconds: 5,
    sleep: async () => {},
    onTick: (remaining) => ticks.push(remaining),
    isCancelled: () => false,
    shouldSkip: () => ticks.length >= 2,
  });

  expect(result).toBe("skipped");
  expect(ticks).toEqual([5, 4]);
});

function remainingCancelledAfterFirstTick(ticks: readonly number[]): boolean {
  return ticks.length > 0;
}
