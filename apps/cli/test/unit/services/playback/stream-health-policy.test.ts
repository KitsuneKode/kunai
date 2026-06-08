import { describe, expect, test } from "bun:test";

import { planStreamHealth } from "@kunai/providers";

function planCacheRevalidate(
  input: Omit<Parameters<typeof planStreamHealth>[0], "phase" | "url"> & {
    readonly url?: string | null;
  },
) {
  return planStreamHealth({
    phase: "cache-revalidate",
    url: input.url ?? "",
    cachedAt: input.cachedAt,
    force: input.force,
    now: input.now,
    staleAfterMs: input.staleAfterMs,
  });
}

describe("stream health cache policy", () => {
  const now = 10_000_000;

  test("does not check when there is no cached stream timestamp", () => {
    expect(planCacheRevalidate({ url: "https://cdn.example/a.m3u8", now })).toMatchObject({
      shouldProbe: false,
      strategy: "none",
      policyReason: "no-cache",
    });
  });

  test("does not check fresh cached streams", () => {
    expect(
      planCacheRevalidate({
        url: "https://cdn.example/a.m3u8",
        cachedAt: now - 60_000,
        now,
      }),
    ).toMatchObject({
      shouldProbe: false,
      strategy: "none",
      policyReason: "fresh",
      ageMs: 60_000,
    });
  });

  test("checks cached manifests before the nominal stream TTL expires", () => {
    expect(
      planCacheRevalidate({
        url: "https://cdn.example/a.m3u8",
        cachedAt: now - 2 * 60_000,
        now,
      }),
    ).toMatchObject({
      shouldProbe: true,
      strategy: "hls-manifest-get",
      policyReason: "stale-hls",
      ageMs: 120_000,
    });
  });

  test("checks fresh cached streams when forced by playback failure", () => {
    expect(
      planCacheRevalidate({
        url: "https://cdn.example/a.m3u8",
        cachedAt: now - 60_000,
        now,
        force: true,
      }),
    ).toMatchObject({
      shouldProbe: true,
      strategy: "hls-manifest-get",
      policyReason: "forced-hls",
      ageMs: 60_000,
    });
  });

  test("checks stale HLS manifests with a manifest GET", () => {
    expect(
      planCacheRevalidate({
        url: "https://cdn.example/master.m3u8?token=signed",
        cachedAt: now - 3 * 60 * 60 * 1000,
        now,
      }),
    ).toMatchObject({
      shouldProbe: true,
      strategy: "hls-manifest-get",
      policyReason: "stale-hls",
    });
  });

  test("checks stale direct files with head then ranged get", () => {
    expect(
      planCacheRevalidate({
        url: "https://cdn.example/movie.mp4",
        cachedAt: now - 3 * 60 * 60 * 1000,
        now,
      }),
    ).toMatchObject({
      shouldProbe: true,
      strategy: "head-then-range",
      policyReason: "stale-direct",
    });
  });
});
