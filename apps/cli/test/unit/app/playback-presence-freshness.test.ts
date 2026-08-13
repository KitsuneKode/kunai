import { describe, expect, test } from "bun:test";

import { isPlaybackPresenceUpdateCurrent } from "@/app/playback/playback-presence-freshness";
import type { PlaybackStatusSnapshot } from "@/app/playback/playback-status-policy";

const GEN = { process: 2, cycle: 7 } as const;

function snapshot(
  status: PlaybackStatusSnapshot["status"],
  generation: PlaybackStatusSnapshot["generation"] = GEN,
): PlaybackStatusSnapshot {
  return { status, generation };
}

describe("isPlaybackPresenceUpdateCurrent", () => {
  test("an unchanged snapshot is still current", () => {
    expect(isPlaybackPresenceUpdateCurrent(snapshot("playing"), snapshot("playing"))).toBe(true);
  });

  test("a queued update is discarded when the generation changed before execution", () => {
    expect(
      isPlaybackPresenceUpdateCurrent(
        snapshot("playing", { process: 2, cycle: 8 }),
        snapshot("playing"),
      ),
    ).toBe(false);
  });

  test("a queued update is discarded when the process changed before execution", () => {
    expect(
      isPlaybackPresenceUpdateCurrent(
        snapshot("playing", { process: 3, cycle: 1 }),
        snapshot("playing"),
      ),
    ).toBe(false);
  });

  test("a playing update is discarded once playback became paused", () => {
    expect(isPlaybackPresenceUpdateCurrent(snapshot("paused"), snapshot("playing"))).toBe(false);
  });

  test("a paused update is discarded once playback resumed", () => {
    expect(isPlaybackPresenceUpdateCurrent(snapshot("playing"), snapshot("paused"))).toBe(false);
  });

  test("a playing update is discarded once playback stopped", () => {
    expect(isPlaybackPresenceUpdateCurrent(snapshot("idle"), snapshot("playing"))).toBe(false);
  });

  test("a stall-recovery update scheduled against the recovered playing snapshot is current", () => {
    // The policy recovered buffering -> playing, and presence was scheduled with
    // that accepted snapshot, so it must still be publishable.
    expect(isPlaybackPresenceUpdateCurrent(snapshot("playing"), snapshot("playing"))).toBe(true);
    expect(isPlaybackPresenceUpdateCurrent(snapshot("playing"), snapshot("buffering"))).toBe(false);
  });
});
