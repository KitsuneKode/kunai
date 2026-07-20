import { describe, expect, test } from "bun:test";

import {
  ENGAGE_SECONDS,
  PERSIST_RESUME_SECONDS,
  evaluateProgressEngage,
  isDidNotStartProgress,
} from "@/domain/playback/progress-engage-policy";

describe("ProgressEngagePolicy", () => {
  test("exports locked dual-gate constants", () => {
    expect(PERSIST_RESUME_SECONDS).toBe(10);
    expect(ENGAGE_SECONDS).toBe(30);
  });

  test("persist gate requires trusted > 10s", () => {
    expect(
      evaluateProgressEngage({ trustedProgressSeconds: 10, durationSeconds: 600 }).canPersistResume,
    ).toBe(false);
    expect(
      evaluateProgressEngage({ trustedProgressSeconds: 11, durationSeconds: 600 }).canPersistResume,
    ).toBe(true);
  });

  test("engage gate requires trusted > 30s", () => {
    const mid = evaluateProgressEngage({ trustedProgressSeconds: 30, durationSeconds: 600 });
    expect(mid.isEngaged).toBe(false);
    expect(mid.shouldBumpLastWatched).toBe(false);

    const engaged = evaluateProgressEngage({ trustedProgressSeconds: 31, durationSeconds: 600 });
    expect(engaged.isEngaged).toBe(true);
    expect(engaged.shouldBumpLastWatched).toBe(true);
    expect(engaged.canPersistResume).toBe(true);
  });

  test("stuck ~0 with known duration is did-not-start", () => {
    const evidence = { trustedProgressSeconds: 0, durationSeconds: 1400 };
    expect(isDidNotStartProgress(evidence)).toBe(true);
    const decision = evaluateProgressEngage(evidence);
    expect(decision.isDidNotStart).toBe(true);
    expect(decision.canPersistResume).toBe(false);
    expect(decision.isEngaged).toBe(false);
    expect(decision.shouldBumpLastWatched).toBe(false);
  });

  test("completion override may bump last-watched without engage", () => {
    const decision = evaluateProgressEngage(
      { trustedProgressSeconds: 5, durationSeconds: 600, endReason: "eof" },
      { reachedCompletionThreshold: true },
    );
    expect(decision.shouldBumpLastWatched).toBe(true);
    expect(decision.isEngaged).toBe(false);
  });

  test("suspected dead stream at ~0 is did-not-start", () => {
    expect(
      isDidNotStartProgress({
        trustedProgressSeconds: 0,
        durationSeconds: 900,
        suspectedDeadStream: true,
      }),
    ).toBe(true);
  });
});
