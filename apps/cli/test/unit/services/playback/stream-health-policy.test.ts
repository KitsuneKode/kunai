import { describe, expect, test } from "bun:test";

import { resolveStreamHealthPolicy } from "@/services/playback/stream-health-policy";

describe("stream health policy", () => {
  const now = 10_000_000;

  test("does not check when there is no cached stream timestamp", () => {
    expect(resolveStreamHealthPolicy({ url: "https://cdn.example/a.m3u8", now })).toMatchObject({
      shouldCheck: false,
      strategy: "none",
      reason: "no-cache",
    });
  });

  test("does not check fresh cached streams", () => {
    expect(
      resolveStreamHealthPolicy({
        url: "https://cdn.example/a.m3u8",
        cachedAt: now - 60_000,
        now,
      }),
    ).toMatchObject({
      shouldCheck: false,
      strategy: "none",
      reason: "fresh",
      ageMs: 60_000,
    });
  });

  test("checks fresh cached streams when forced by playback failure", () => {
    expect(
      resolveStreamHealthPolicy({
        url: "https://cdn.example/a.m3u8",
        cachedAt: now - 60_000,
        now,
        force: true,
      }),
    ).toMatchObject({
      shouldCheck: true,
      strategy: "hls-manifest-get",
      reason: "forced-hls",
      ageMs: 60_000,
    });
  });

  test("checks stale HLS manifests with a manifest GET", () => {
    expect(
      resolveStreamHealthPolicy({
        url: "https://cdn.example/master.m3u8?token=signed",
        cachedAt: now - 3 * 60 * 60 * 1000,
        now,
      }),
    ).toMatchObject({
      shouldCheck: true,
      strategy: "hls-manifest-get",
      reason: "stale-hls",
    });
  });

  test("checks stale direct files with head then ranged get", () => {
    expect(
      resolveStreamHealthPolicy({
        url: "https://cdn.example/movie.mp4",
        cachedAt: now - 3 * 60 * 60 * 1000,
        now,
      }),
    ).toMatchObject({
      shouldCheck: true,
      strategy: "head-then-range",
      reason: "stale-direct",
    });
  });
});
