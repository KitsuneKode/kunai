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

  test("playback-preflight probes fresh streams that were never verified", () => {
    // Resolve age alone must not waive the probe: providers without a
    // resolve-gate hand streams here that no code has ever fetched, and an
    // episode-to-episode replacement trusts the same plan.
    expect(
      planStreamHealth({
        phase: "playback-preflight",
        url: "https://cdn.example/live.m3u8",
        cachedAt: now - 60_000,
        now,
      }),
    ).toMatchObject({
      shouldProbe: true,
      policyReason: "forced-hls",
    });
  });

  test("playback-preflight probes verified streams past the trust window", () => {
    expect(
      planStreamHealth({
        phase: "playback-preflight",
        url: "https://cdn.example/live.m3u8",
        cachedAt: now - 10 * 60_000,
        streamReachabilityVerified: true,
        now,
      }),
    ).toMatchObject({
      shouldProbe: true,
      policyReason: "forced-hls",
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

  test("resolve-gate retries a non-definitive probe once, preserving headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await runStreamHealthCheck({
      phase: "resolve-gate",
      url: "https://cdn.example/video.mp4",
      headers: { Referer: "https://provider.example/watch" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response("", { status: calls.length >= 3 ? 200 : 500 });
      },
      cachedAt: Date.now(),
      now: Date.now(),
    });

    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(
      calls.every(
        (call) =>
          call.init.headers === undefined ||
          (call.init.headers as Record<string, string>).Referer ===
            "https://provider.example/watch",
      ),
    ).toBe(true);
    expect(result.probe?.status).toBe("reachable");
  });

  test("resolve-gate does not retry a definitive refusal", async () => {
    const calls: string[] = [];
    const result = await runStreamHealthCheck({
      phase: "resolve-gate",
      url: "https://cdn.example/video.mp4",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response("", { status: 404 });
      },
      cachedAt: Date.now(),
      now: Date.now(),
    });

    expect(calls.length).toBe(1);
    expect(result.probe?.status).toBe("unreachable");
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
      timeoutMs: STREAM_HEALTH_DEFAULTS.resolveGateTimeoutMs,
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
