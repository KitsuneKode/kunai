import { describe, expect, test } from "bun:test";

import type { PlaybackTimingMetadata } from "@/domain/types";
import { createVlcSkipTracker, vlcSeekTarget } from "@/infra/player/vlc/vlc-auto-skip";

const TIMING: PlaybackTimingMetadata = {
  tmdbId: "1",
  type: "series",
  recap: [],
  intro: [{ startMs: 30_000, endMs: 120_400 }],
  credits: [{ startMs: 1_300_000, endMs: 1_380_000 }],
  preview: [],
};

describe("createVlcSkipTracker", () => {
  test("skips the intro once, at its end", () => {
    const skips = createVlcSkipTracker({ timing: TIMING });
    expect(skips.observe(10)).toBeNull();
    expect(skips.observe(31)).toMatchObject({ kind: "intro", endSeconds: 120.4 });
    // Still inside the segment on the next poll: already done.
    expect(skips.observe(32)).toBeNull();
  });

  test("a backward seek before the intro re-arms it", () => {
    const skips = createVlcSkipTracker({ timing: TIMING });
    expect(skips.observe(31)?.kind).toBe("intro");
    skips.observe(121);
    skips.observe(5);
    expect(skips.observe(31)?.kind).toBe("intro");
  });

  test("auto-skip off skips nothing; the user's skip key still works once", () => {
    const skips = createVlcSkipTracker({ timing: TIMING, autoSkipEnabled: false });
    expect(skips.observe(40)).toBeNull();
    expect(skips.manual()?.kind).toBe("intro");
    expect(skips.manual()).toBeNull();
  });

  test("turning auto-skip off mid-episode stops the next skip", () => {
    const skips = createVlcSkipTracker({ timing: TIMING });
    skips.setAutoSkipEnabled(false);
    expect(skips.observe(1_310)).toBeNull();
    skips.setAutoSkipEnabled(true);
    expect(skips.observe(1_311)?.kind).toBe("credits");
  });

  test("timing that arrives late is used from then on", () => {
    const skips = createVlcSkipTracker({ timing: null });
    expect(skips.observe(40)).toBeNull();
    skips.setTiming(TIMING);
    expect(skips.timing()).toBe(TIMING);
    expect(skips.observe(41)?.kind).toBe("intro");
  });

  test("the intro toggle alone turns intro skipping off", () => {
    const skips = createVlcSkipTracker({ timing: TIMING, skipIntro: false });
    expect(skips.observe(40)).toBeNull();
  });
});

test("VLC seeks to the nearest whole second", () => {
  expect(vlcSeekTarget(120.4)).toBe(120);
  expect(vlcSeekTarget(120.5)).toBe(121);
  expect(vlcSeekTarget(-1)).toBe(0);
});
