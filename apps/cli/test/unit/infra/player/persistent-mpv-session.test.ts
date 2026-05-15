import { describe, expect, test } from "bun:test";

import {
  buildPersistentLoadfileCommand,
  resolveNearEofPrefetchTriggerSeconds,
  resolvePersistentStartSeekTarget,
} from "@/infra/player/PersistentMpvSession";

describe("persistent mpv start policy", () => {
  test("seeks directly for explicit continue/resume intents", () => {
    expect(resolvePersistentStartSeekTarget({ startAt: 562 })).toBe(562);
  });

  test("does not seek while offering a start-over prompt unless the user chooses resume", () => {
    const options = {
      startAt: 0,
      resumePromptAt: 562,
      offerResumeStartChoice: true,
    };

    expect(resolvePersistentStartSeekTarget(options)).toBeUndefined();
    expect(resolvePersistentStartSeekTarget(options, "start")).toBeUndefined();
    expect(resolvePersistentStartSeekTarget(options, "resume")).toBe(562);
  });

  test("keeps navigation start-at-zero when no prompt is available", () => {
    expect(
      resolvePersistentStartSeekTarget({
        startAt: 0,
        resumePromptAt: 562,
        offerResumeStartChoice: false,
      }),
    ).toBeUndefined();
  });

  test("builds file-local loadfile start options for every persistent replacement", () => {
    expect(buildPersistentLoadfileCommand("https://cdn.example/next.m3u8")).toEqual([
      "loadfile",
      "https://cdn.example/next.m3u8",
      "replace",
      -1,
      { start: "0" },
    ]);

    expect(buildPersistentLoadfileCommand("https://cdn.example/resume.m3u8", 562)).toEqual([
      "loadfile",
      "https://cdn.example/resume.m3u8",
      "replace",
      -1,
      { start: "562" },
    ]);
  });
});

describe("persistent mpv prefetch trigger", () => {
  test("uses credits timing to prefetch before the user reaches skip/quit territory", () => {
    expect(
      resolveNearEofPrefetchTriggerSeconds(1500, {
        tmdbId: "tmdb:1",
        type: "series",
        recap: [],
        intro: [],
        preview: [],
        credits: [{ startMs: 1_200_000, endMs: 1_320_000 }],
      }),
    ).toBe(1155);
  });

  test("falls back to the final thirty seconds when no credible credits timing exists", () => {
    expect(resolveNearEofPrefetchTriggerSeconds(1500)).toBe(1470);
    expect(
      resolveNearEofPrefetchTriggerSeconds(1500, {
        tmdbId: "tmdb:1",
        type: "series",
        recap: [],
        intro: [],
        preview: [],
        credits: [{ startMs: 120_000, endMs: 180_000 }],
      }),
    ).toBe(1470);
  });

  test("does not prefetch tiny or live-like durations", () => {
    expect(resolveNearEofPrefetchTriggerSeconds(20)).toBeNull();
    expect(resolveNearEofPrefetchTriggerSeconds(Number.NaN)).toBeNull();
  });
});
