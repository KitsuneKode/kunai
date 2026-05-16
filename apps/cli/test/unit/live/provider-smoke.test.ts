import { describe, expect, test } from "bun:test";

import type { StreamInfo, TitleInfo } from "@/domain/types";

import { buildProviderSmokePayload } from "../../live/provider-smoke";

describe("provider smoke payload", () => {
  test("includes privacy-safe provider reliability fields", () => {
    const title: TitleInfo = { id: "127529", type: "series", name: "Bloodhounds" };
    const stream: StreamInfo = {
      url: "https://cdn.example/watch/1234567890/master.m3u8?token=secret",
      headers: { Referer: "https://provider.example" },
      timestamp: Date.now(),
      providerResolveResult: {
        status: "resolved",
        providerId: "vidking",
        selectedStreamId: "main",
        streams: [
          {
            id: "main",
            providerId: "vidking",
            url: "https://cdn.example/watch/1234567890/master.m3u8?token=secret",
            protocol: "hls",
            confidence: 1,
            headers: {},
            cachePolicy: {
              ttlClass: "stream-manifest",
              scope: "local",
              keyParts: ["vidking", "127529"],
            },
          },
        ],
        subtitles: [],
        failures: [
          {
            providerId: "vidking",
            code: "timeout",
            message: "Mirror timed out",
            retryable: true,
            at: "2026-05-17T00:00:00.000Z",
          },
        ],
        trace: {
          id: "trace-1",
          startedAt: "2026-05-17T00:00:00.000Z",
          title: { id: "127529", kind: "series", title: "Bloodhounds" },
          selectedProviderId: "vidking",
          runtime: "direct-http",
          cacheHit: false,
          steps: [],
          failures: [],
        },
      },
    };

    const payload = buildProviderSmokePayload({
      provider: "vidking",
      title,
      season: 1,
      episode: 2,
      stream,
      resolveDurationMs: 1234,
    });

    expect(payload).toMatchObject({
      ok: true,
      skipped: false,
      provider: "vidking",
      providerId: "vidking",
      engine: "direct-http",
      resolveDurationMs: 1234,
      streamResolved: true,
      streamHost: "cdn.example",
      failureCodes: ["timeout"],
    });
    expect(JSON.stringify(payload)).not.toContain("token=secret");
    expect(JSON.stringify(payload)).not.toContain("1234567890");
  });
});
