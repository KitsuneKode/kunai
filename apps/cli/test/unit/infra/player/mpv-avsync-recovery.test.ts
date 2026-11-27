import { describe, expect, test } from "bun:test";

import {
  MpvAvsyncRecoveryTracker,
  type MpvAvsyncRecoveryGuards,
} from "@/infra/player/mpv-avsync-recovery";

function guards(overrides: Partial<MpvAvsyncRecoveryGuards> = {}): MpvAvsyncRecoveryGuards {
  return {
    enabled: true,
    paused: false,
    coreIdle: false,
    live: false,
    reconnecting: false,
    resumeSeekPending: false,
    outputStarted: true,
    retired: false,
    hasIpcSession: true,
    resyncInFlight: false,
    ...overrides,
  };
}

function sustainedDrift(
  tracker: MpvAvsyncRecoveryTracker,
  at: number,
  guardOverrides: Partial<MpvAvsyncRecoveryGuards> = {},
) {
  return [
    tracker.evaluate(0.5, at, guards(guardOverrides)),
    tracker.evaluate(0.5, at + 100, guards(guardOverrides)),
    tracker.evaluate(0.5, at + 300, guards(guardOverrides)),
  ];
}

describe("MpvAvsyncRecoveryTracker", () => {
  test("sustained drift authorizes one correction after the restart grace", () => {
    let now = 10_000;
    const tracker = new MpvAvsyncRecoveryTracker({ now: () => now });
    expect(sustainedDrift(tracker, 10_000).every((decision) => decision.kind === "none")).toBe(
      true,
    );

    tracker.restartEpisode();
    now = 11_100;
    expect(sustainedDrift(tracker, 11_100).at(-1)).toEqual({ kind: "resync", attempt: 1 });
  });

  test("paused-for-cache suppresses and clears stale drift evidence", () => {
    let now = 10_000;
    const tracker = new MpvAvsyncRecoveryTracker({ now: () => now });
    now = 11_100;
    tracker.evaluate(0.5, 11_100, guards());
    tracker.evaluate(0.5, 11_200, guards());
    tracker.notePausedForCache(true);
    expect(tracker.evaluate(0.5, 11_300, guards()).kind).toBe("none");
    expect(tracker.snapshot().overLimitSamples).toBe(0);

    tracker.notePausedForCache(false);
    expect(tracker.evaluate(0.5, 11_400, guards()).kind).toBe("none");
    expect(tracker.evaluate(0.5, 11_500, guards()).kind).toBe("none");
    expect(tracker.evaluate(0.5, 11_700, guards())).toEqual({ kind: "resync", attempt: 1 });
  });

  test("resume seeks and Kunai-issued seeks suppress recovery without counting drift", () => {
    let now = 10_000;
    const tracker = new MpvAvsyncRecoveryTracker({ now: () => now });
    now = 11_100;
    expect(sustainedDrift(tracker, 11_100, { resumeSeekPending: true }).at(-1)?.kind).toBe("none");

    tracker.beginKunaiSeek();
    expect(sustainedDrift(tracker, 12_100).at(-1)?.kind).toBe("none");
    tracker.endKunaiSeek();
    now = 13_100;
    expect(sustainedDrift(tracker, 13_100).at(-1)).toEqual({ kind: "resync", attempt: 1 });
  });

  test("a seeking transition clears evidence instead of carrying it across the seek", () => {
    let now = 10_000;
    const tracker = new MpvAvsyncRecoveryTracker({ now: () => now });
    now = 11_100;
    tracker.evaluate(0.5, 11_100, guards());
    tracker.evaluate(0.5, 11_200, guards());
    tracker.noteSeeking(true);
    tracker.noteSeeking(false);
    expect(tracker.evaluate(0.5, 11_300, guards()).kind).toBe("none");
    expect(tracker.evaluate(0.5, 11_400, guards()).kind).toBe("none");
    expect(tracker.evaluate(0.5, 11_600, guards()).kind).toBe("resync");
  });

  test("drift returning immediately after a resync exhausts recovery instead of looping", () => {
    let now = 10_000;
    const tracker = new MpvAvsyncRecoveryTracker({ now: () => now });
    now = 11_100;
    expect(sustainedDrift(tracker, 11_100).at(-1)).toEqual({ kind: "resync", attempt: 1 });

    now = 12_000;
    expect(sustainedDrift(tracker, 12_000).at(-1)?.kind).toBe("none");
    expect(tracker.snapshot()).toMatchObject({ exhausted: true, resyncCount: 1 });

    now = 20_000;
    expect(sustainedDrift(tracker, 20_000).at(-1)?.kind).toBe("none");
  });

  test("separated failures use at most two corrections per episode", () => {
    let now = 10_000;
    const tracker = new MpvAvsyncRecoveryTracker({ now: () => now });
    now = 11_100;
    expect(sustainedDrift(tracker, 11_100).at(-1)).toEqual({ kind: "resync", attempt: 1 });

    now = 17_000;
    expect(sustainedDrift(tracker, 17_000).at(-1)).toEqual({ kind: "resync", attempt: 2 });

    now = 23_000;
    expect(sustainedDrift(tracker, 23_000).at(-1)?.kind).toBe("none");
    expect(tracker.snapshot()).toMatchObject({ exhausted: true, resyncCount: 2 });

    tracker.restartEpisode();
    now = 24_200;
    expect(sustainedDrift(tracker, 24_200).at(-1)).toEqual({ kind: "resync", attempt: 1 });
  });

  test("cache stalls, core idle, missing output, and live playback are suppressed", () => {
    for (const override of [
      { coreIdle: true },
      { outputStarted: false },
      { live: true },
    ] satisfies Partial<MpvAvsyncRecoveryGuards>[]) {
      let now = 10_000;
      const tracker = new MpvAvsyncRecoveryTracker({ now: () => now });
      now = 11_100;
      expect(sustainedDrift(tracker, 11_100, override).at(-1)?.kind).toBe("none");
    }
  });
});
