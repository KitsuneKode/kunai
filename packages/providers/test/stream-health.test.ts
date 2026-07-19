import { describe, expect, test } from "bun:test";

import {
  evaluateStreamHealth,
  planStreamHealth,
  runStreamHealthCheck,
  STREAM_HEALTH_DEFAULTS,
} from "../src/shared/stream-health";

describe("stream health", () => {
  const now = 10_000_000;

  test("resolve-gate trusts provider attestation and skips duplicate probes", () => {
    expect(
      planStreamHealth({
        phase: "resolve-gate",
        url: "https://cdn.example/live.m3u8",
        cachedAt: now,
        streamReachabilityVerified: true,
        now,
      }),
    ).toMatchObject({
      shouldProbe: false,
      skipReason: "provider-attested",
      policyReason: "provider-attested",
    });
  });

  test("resolve-gate probes unverified fresh streams", () => {
    expect(
      planStreamHealth({
        phase: "resolve-gate",
        url: "https://cdn.example/live.m3u8",
        cachedAt: now,
        now,
      }),
    ).toMatchObject({
      shouldProbe: true,
      strategy: "hls-manifest-get",
      policyReason: "forced-hls",
    });
  });

  test("cache-revalidate keeps fresh cache without probing", () => {
    expect(
      planStreamHealth({
        phase: "cache-revalidate",
        url: "https://cdn.example/live.m3u8",
        cachedAt: now - 60_000,
        now,
      }),
    ).toMatchObject({
      shouldProbe: false,
      skipReason: "fresh-cache",
      policyReason: "fresh",
      ageMs: 60_000,
    });
  });

  test("cache-revalidate still probes when forced after playback failure", () => {
    expect(
      planStreamHealth({
        phase: "cache-revalidate",
        url: "https://cdn.example/live.m3u8",
        cachedAt: now - 60_000,
        force: true,
        now,
      }),
    ).toMatchObject({
      shouldProbe: true,
      policyReason: "forced-hls",
    });
  });

  test("playback-preflight skips recent trusted resolves", () => {
    expect(
      planStreamHealth({
        phase: "playback-preflight",
        url: "https://cdn.example/live.m3u8",
        cachedAt: now - 60_000,
        streamReachabilityVerified: true,
        now,
      }),
    ).toMatchObject({
      shouldProbe: false,
      skipReason: "provider-attested",
    });
  });

  test("skips probes for youtube watch URLs and requiresYtdl streams", () => {
    expect(
      planStreamHealth({
        phase: "cache-revalidate",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        cachedAt: now - 5 * 60_000,
        now,
      }),
    ).toMatchObject({
      shouldProbe: false,
      skipReason: "provider-attested",
      policyReason: "provider-attested",
    });
    expect(
      planStreamHealth({
        phase: "resolve-gate",
        url: "https://example.com/stream",
        requiresYtdl: true,
        now,
      }),
    ).toMatchObject({
      shouldProbe: false,
      skipReason: "provider-attested",
    });
  });

  test("playback-preflight stays lenient on timeout", () => {
    expect(evaluateStreamHealth("playback-preflight", { status: "timeout" })).toBe(true);
    expect(evaluateStreamHealth("resolve-gate", { status: "timeout" })).toBe(true);
  });

  test("runStreamHealthCheck performs HLS GET probes with provider headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await runStreamHealthCheck({
      phase: "resolve-gate",
      url: "https://cdn.example/master.m3u8",
      headers: { Referer: "https://provider.example/watch" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (String(url).endsWith("master.m3u8")) {
          return new Response("#EXTM3U\n#EXTINF:3,\n/seg-1.ts\n", { status: 200 });
        }
        return new Response(new Uint8Array(2048).fill(1), { status: 206 });
      },
      timeoutMs: STREAM_HEALTH_DEFAULTS.vidkingResolveGateTimeoutMs,
    });

    expect(result).toMatchObject({
      healthy: true,
      probed: true,
      strategy: "hls-manifest-get",
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.headers).toEqual({ Referer: "https://provider.example/watch" });
  });
});
