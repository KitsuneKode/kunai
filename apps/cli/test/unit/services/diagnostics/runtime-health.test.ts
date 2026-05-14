import { describe, expect, test } from "bun:test";

import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";
import {
  buildRuntimeHealthSnapshot,
  formatNetworkRate,
} from "@/services/diagnostics/runtime-health";

function event(
  timestamp: number,
  category: DiagnosticEvent["category"],
  message: string,
  context?: Record<string, unknown>,
): DiagnosticEvent {
  return { timestamp, level: "info", category, operation: category, message, context };
}

describe("runtime health diagnostics", () => {
  test("formatNetworkRate chooses readable units", () => {
    expect(formatNetworkRate(0)).toBe("0 B/s");
    expect(formatNetworkRate(96_000)).toBe("93.8 KiB/s");
    expect(formatNetworkRate(2_500_000)).toBe("2.4 MiB/s");
  });

  test("summarizes active network samples as healthy playback", () => {
    const health = buildRuntimeHealthSnapshot({
      currentProvider: "vidking",
      recentEvents: [
        event(3000, "playback", "MPV runtime event", {
          event: "network-sample",
          cacheSpeed: 2_500_000,
          cacheAheadSeconds: 18.2,
          demuxerViaNetwork: true,
        }),
        event(2000, "provider", "Provider resolve attempt succeeded", {
          provider: "vidking",
        }),
        event(1000, "provider", "Resolve trace started", {}),
      ],
    });

    expect(health.network).toEqual({
      label: "Network",
      detail: "2.4 MiB/s · 18.2s cache ahead · HLS active",
      tone: "success",
    });
    expect(health.provider.detail).toContain("vidking · resolved in 1.0s");
    expect(health.provider.tone).toBe("success");
  });

  test("summarizes direct provider trace details", () => {
    const health = buildRuntimeHealthSnapshot({
      currentProvider: "rivestream",
      recentEvents: [
        event(3000, "provider", "Provider resolve trace completed", {
          trace: {
            id: "trace-1",
            startedAt: "2026-05-06T00:00:00.000Z",
            endedAt: "2026-05-06T00:00:01.100Z",
            title: { id: "1396", name: "Breaking Bad", type: "series" },
            selectedProviderId: "rivestream",
            selectedStreamId: "stream-1",
            cacheHit: false,
            runtime: "direct-http",
            steps: [
              {
                at: "2026-05-06T00:00:01.100Z",
                stage: "provider",
                message: "Resolved Rivestream through local MurmurHash",
                providerId: "rivestream",
                attributes: { streams: 2 },
              },
            ],
            failures: [],
          },
          streamCandidates: 2,
          subtitleCandidates: 3,
          cachePolicy: { ttlClass: "stream-manifest" },
        }),
        event(1000, "provider", "Resolve trace started", {}),
      ],
    });

    expect(health.provider).toEqual({
      label: "Provider",
      detail: "rivestream · direct-http · provider · cache miss · 2 streams · 3 subtitles",
      tone: "success",
    });
  });

  test("summarizes provider failure codes without hiding retryability", () => {
    const health = buildRuntimeHealthSnapshot({
      currentProvider: "miruro",
      recentEvents: [
        event(2200, "provider", "Provider resolve attempt failed", {
          stage: "provider-resolve",
          provider: "miruro",
          failure: {
            code: "provider-unavailable",
            message: "Miruro backend returned 503",
            retryable: true,
            at: "2026-05-06T00:00:02.200Z",
          },
        }),
        event(1000, "provider", "Resolve trace started", {}),
      ],
    });

    expect(health.provider).toEqual({
      label: "Provider",
      detail:
        "miruro · failed at provider-resolve after 1.2s · provider-unavailable · retryable · Miruro backend returned 503",
      tone: "error",
    });
  });

  test("summarizes stream stalls as actionable network errors", () => {
    const health = buildRuntimeHealthSnapshot({
      currentProvider: "vidking",
      recentEvents: [
        event(3000, "playback", "MPV runtime event", {
          event: "stream-stalled",
          stallKind: "network-read-dead",
          secondsWithoutProgress: 8,
        }),
      ],
    });

    expect(health.network.detail).toBe("read idle for 8s · recover or switch source");
    expect(health.network.tone).toBe("error");
  });
});
