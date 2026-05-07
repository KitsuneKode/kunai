import { expect, test } from "bun:test";

import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import type { StreamInfo } from "@/domain/types";

const hardsubStream: StreamInfo = {
  url: "https://cdn.example/1080.m3u8",
  headers: {},
  timestamp: Date.now(),
  providerResolveResult: {
    providerId: "allanime",
    selectedStreamId: "sub-en",
    streams: [
      {
        id: "sub-en",
        providerId: "allanime",
        sourceId: "source-a",
        protocol: "hls",
        qualityLabel: "1080p",
        qualityRank: 1080,
        audioLanguage: "ja",
        hardSubLanguage: "en",
        url: "https://cdn.example/1080.m3u8",
        headers: {},
        confidence: 0.9,
        cachePolicy: {
          ttlClass: "stream-manifest",
          scope: "local",
          keyParts: [],
        },
      },
    ],
    sources: [],
    subtitles: [],
    trace: {
      id: "trace-1",
      startedAt: new Date().toISOString(),
      cacheHit: false,
      title: { id: "1", kind: "series", title: "Demo" },
      steps: [],
      failures: [],
    },
    failures: [],
  },
};

test("describePlaybackSubtitleStatus treats hardsub inventory as subtitles available", () => {
  expect(describePlaybackSubtitleStatus(hardsubStream, "en")).toBe("hardsub en");
});

test("describePlaybackSubtitleStatus keeps true missing subtitles explicit", () => {
  expect(
    describePlaybackSubtitleStatus(
      {
        url: "https://cdn.example/1080.m3u8",
        headers: {},
        timestamp: Date.now(),
      },
      "en",
    ),
  ).toBe("subtitles not found");
});
