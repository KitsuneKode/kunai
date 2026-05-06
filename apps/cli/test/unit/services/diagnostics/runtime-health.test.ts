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
  return { timestamp, category, message, context };
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
