import { describe, expect, test } from "bun:test";

import {
  buildPersistentLoadfileCommand,
  extractExternalSubtitleIds,
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

  test("keeps 0 start-at when offerResumeStartChoice handles it", () => {
    expect(
      resolvePersistentStartSeekTarget({
        startAt: 0,
        resumePromptAt: 0,
        offerResumeStartChoice: false,
      }),
    ).toBeUndefined();
  });

  test("loadfile start matches seek target for direct continue", () => {
    const startAt = 562;
    const cmd = buildPersistentLoadfileCommand("https://cdn.example/e.m3u8", startAt);
    const target = resolvePersistentStartSeekTarget({ startAt });

    // Both produce the same position — the seek in runReadyWork should be skipped.
    expect(cmd[4].start).toBe("562");
    expect(target).toBe(562);
  });

  test("loadfile start is 0 when resume prompt will handle the seek later", () => {
    const startAt = 0;
    const resumePromptAt = 562;
    const cmd = buildPersistentLoadfileCommand("https://cdn.example/e.m3u8", startAt);
    const target = resolvePersistentStartSeekTarget(
      { startAt, resumePromptAt, offerResumeStartChoice: true },
      "resume",
    );

    // loadfile loads at 0, seek target is 562 — they differ → seek IS needed (not redundant)
    expect(cmd[4].start).toBe("0");
    expect(target).toBe(562);
  });

  test("loadfile start is 0 when no resume position exists", () => {
    const cmd = buildPersistentLoadfileCommand("https://cdn.example/fresh.m3u8", 0);
    const target = resolvePersistentStartSeekTarget({ startAt: 0 });

    expect(cmd[4].start).toBe("0");
    expect(target).toBeUndefined();
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
    ).toBe(1140);
  });

  test("uses the adaptive ninety-percent fallback when no credible credits timing exists", () => {
    expect(resolveNearEofPrefetchTriggerSeconds(1500)).toBe(1350);
    expect(
      resolveNearEofPrefetchTriggerSeconds(1500, {
        tmdbId: "tmdb:1",
        type: "series",
        recap: [],
        intro: [],
        preview: [],
        credits: [{ startMs: 120_000, endMs: 180_000 }],
      }),
    ).toBe(1350);
  });

  test("does not prefetch tiny or live-like durations", () => {
    expect(resolveNearEofPrefetchTriggerSeconds(20)).toBeNull();
    expect(resolveNearEofPrefetchTriggerSeconds(Number.NaN)).toBeNull();
  });
});

describe("persistent mpv subtitle track cache", () => {
  test("extracts only external subtitle track ids from mpv track-list payloads", () => {
    expect(
      extractExternalSubtitleIds([
        { id: 1, type: "video", external: false },
        { id: 2, type: "sub", external: false },
        { id: 3, type: "sub", external: true },
        { id: "bad", type: "sub", external: true },
        null,
      ]),
    ).toEqual([3]);
    expect(extractExternalSubtitleIds({})).toEqual([]);
  });
});
