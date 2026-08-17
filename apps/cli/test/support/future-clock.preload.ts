/**
 * Run the suite as if it were months from now, to surface time-rot.
 *
 * Time-rot here is always the same shape: a test freezes an injected clock at
 * a date literal while the code under test — or a seed helper — reads the real
 * one. It is green on the day it is written and red forever after, and it
 * lands in CI looking like an unrelated regression. It has now bitten three
 * times: the prune-clock bomb, the stats-service window, and the sync retry
 * wake.
 *
 * A lint rule cannot see this: the literal is fine, the real clock is fine,
 * only the pairing is wrong. So detect it empirically instead — advance the
 * clock and see what stops working. A test that owns both sides of its clock
 * does not care what today is; one that half-owns it fails immediately.
 *
 *   bun run --cwd apps/cli test:future
 *
 * This moves the clock through `setSystemTime` rather than by patching the
 * `Date` global, so a test that takes control of its own clock simply wins —
 * patching `Date` directly fought those tests and reported seven false
 * positives that were only ever the harness arguing with itself.
 *
 * Failures are not necessarily product bugs. They mark tests whose result
 * depends on the wall clock, which is worth knowing either way.
 */

import { setSystemTime } from "bun:test";

const OFFSET_DAYS = Number(process.env.KUNAI_CLOCK_OFFSET_DAYS ?? "180");

if (Number.isFinite(OFFSET_DAYS) && OFFSET_DAYS !== 0) {
  setSystemTime(new Date(Date.now() + OFFSET_DAYS * 24 * 60 * 60 * 1000));

  if (!process.env.KUNAI_CLOCK_OFFSET_QUIET) {
    console.error(
      `[future-clock] running ${OFFSET_DAYS} days ahead — failures mark wall-clock-dependent tests`,
    );
  }
}
