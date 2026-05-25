import { expect, test } from "bun:test";

import type { StreamInfo, TitleInfo } from "@/domain/types";
import { extractProviderNativeTiming } from "@/infra/timing";

test("extractProviderNativeTiming maps selected provider intro/outro metadata", () => {
  const title: TitleInfo = {
    id: "151807",
    type: "series",
    name: "Solo Leveling",
  };
  const stream = {
    url: "https://cdn.example/master.m3u8",
    headers: {},
    subtitleList: [],
    subtitleSource: "none",
    subtitleEvidence: {
      directSubtitleObserved: false,
      wyzieSearchObserved: false,
      reason: "not-observed",
    },
    title: title.name,
    timestamp: Date.now(),
    providerResolveResult: {
      status: "resolved",
      providerId: "miruro",
      selectedStreamId: "stream:miruro:selected",
      streams: [
        {
          id: "stream:miruro:other",
          providerId: "miruro",
          url: "https://cdn.example/other.m3u8",
          protocol: "hls",
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          metadata: { intro: { start: 10, end: 20 } },
        },
        {
          id: "stream:miruro:selected",
          providerId: "miruro",
          url: "https://cdn.example/selected.m3u8",
          protocol: "hls",
          confidence: 0.9,
          cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: [] },
          metadata: {
            intro: { start: 90, end: 180 },
            outro: { start: 1320, end: 1410 },
          },
        },
      ],
      subtitles: [],
      trace: {
        id: "trace:miruro",
        startedAt: new Date().toISOString(),
        title: { id: "151807", kind: "anime", title: title.name },
        cacheHit: false,
        steps: [],
        failures: [],
      },
      failures: [],
    },
  } satisfies StreamInfo;

  expect(extractProviderNativeTiming(stream, title)).toMatchObject({
    tmdbId: "151807",
    type: "series",
    intro: [{ startMs: 90_000, endMs: 180_000 }],
    credits: [{ startMs: 1_320_000, endMs: 1_410_000 }],
  });
});
