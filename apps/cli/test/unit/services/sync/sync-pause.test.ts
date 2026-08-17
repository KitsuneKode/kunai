import { describe, expect, test } from "bun:test";

import { describePauseState, pauseUntil, resolvePauseState } from "@/services/sync/sync-pause";

const now = new Date("2026-08-14T12:00:00.000Z");

describe("resolvePauseState", () => {
  test("is not paused when nothing is set", () => {
    for (const value of [null, undefined, ""]) {
      expect(resolvePauseState(value, now)).toEqual({ paused: false });
    }
  });

  test("is paused while the instant is still ahead", () => {
    const state = resolvePauseState("2026-08-14T13:00:00.000Z", now);
    expect(state.paused).toBe(true);
  });

  test("stops being paused once the instant passes", () => {
    expect(resolvePauseState("2026-08-14T11:59:59.000Z", now)).toEqual({ paused: false });
  });

  /**
   * A corrupt value must fail open. Reading it as "paused" would stop sync with
   * no expiry and nothing in the UI able to explain it.
   */
  test("fails open on an unparseable value", () => {
    expect(resolvePauseState("soon", now)).toEqual({ paused: false });
  });
});

describe("pauseUntil", () => {
  test("resolves the hour presets from now", () => {
    expect(pauseUntil("1h", now)).toBe("2026-08-14T13:00:00.000Z");
    expect(pauseUntil("8h", now)).toBe("2026-08-14T20:00:00.000Z");
  });

  /** "Until tomorrow" is a wall-clock idea, not now-plus-24h. */
  test("resolves tomorrow to the next local morning", () => {
    const lateNight = new Date(now);
    lateNight.setHours(23, 50, 0, 0);

    const resolved = new Date(pauseUntil("tomorrow", lateNight));
    expect(resolved.getHours()).toBe(9);
    expect(resolved.getDate()).toBe(lateNight.getDate() + 1);
    expect(resolved.getTime()).toBeGreaterThan(lateNight.getTime());
  });

  test("never resolves to an instant already past", () => {
    for (const hour of [0, 8, 9, 10, 18, 23]) {
      const at = new Date(now);
      at.setHours(hour, 30, 0, 0);
      expect(new Date(pauseUntil("tomorrow", at)).getTime()).toBeGreaterThan(at.getTime());
    }
  });
});

describe("describePauseState", () => {
  test("says nothing when not paused", () => {
    expect(describePauseState({ paused: false }, now)).toBeNull();
  });

  test("scales the phrasing to the remaining time", () => {
    const inMinutes = new Date(now.getTime() + 20 * 60_000);
    expect(describePauseState({ paused: true, until: inMinutes }, now)).toBe("paused for 20m");

    const inHours = new Date(now.getTime() + 3 * 60 * 60_000);
    expect(describePauseState({ paused: true, until: inHours }, now)).toBe("paused for 3h");

    const inDays = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
    expect(describePauseState({ paused: true, until: inDays }, now)).toContain("paused until");
  });
});
