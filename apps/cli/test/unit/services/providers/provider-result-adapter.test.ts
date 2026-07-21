import { describe, expect, test } from "bun:test";

import {
  providerResolveResultToStreamInfo,
  subtitleCandidateToTrack,
} from "@/services/providers/provider-result-adapter";
import type { ProviderResolveResult, StreamCandidate, SubtitleCandidate } from "@kunai/types";

describe("provider result adapter", () => {
  test("keeps provider aliases out of subtitle track language fields", () => {
    const track = subtitleCandidateToTrack(
      makeSubtitleCandidate({
        language: "Vietsub",
        label: "Vietsub",
      }),
    );

    expect(track.language).toBeUndefined();
    expect(track.display).toBe("Vietsub");
  });

  test("normalizes real subtitle languages and preserves display labels", () => {
    const track = subtitleCandidateToTrack(
      makeSubtitleCandidate({
        language: "Portuguese (BR)",
        label: "Portuguese (BR)",
      }),
    );

    expect(track.language).toBe("pt");
    expect(track.display).toBe("Portuguese");
  });

  test("honors exact stream selection before provider default", () => {
    const stream = providerResolveResultToStreamInfo({
      result: makeResolveResult(),
      title: "Selected Source",
      subtitlePreference: "none",
      selectedStreamId: "stream-b-720",
    });

    expect(stream?.url).toBe("https://cdn.example/b-720.m3u8");
    expect(stream?.providerResolveResult?.selectedStreamId).toBe("stream-b-720");
  });

  test("honors selected source by choosing the best quality in that source", () => {
    const stream = providerResolveResultToStreamInfo({
      result: makeResolveResult(),
      title: "Selected Source",
      subtitlePreference: "none",
      selectedSourceId: "source-b",
    });

    expect(stream?.url).toBe("https://cdn.example/b-1080.m3u8");
    expect(stream?.providerResolveResult?.selectedStreamId).toBe("stream-b-1080");
  });

  test("keeps deferred provider streams playable without exposing signed media urls as stream url", () => {
    const result = makeResolveResult({
      streams: [
        makeStream("stream-ak-1080", "source-ak", undefined, 1080, {
          protocol: "dash",
          container: "mpd",
          deferredLocator: "allmanga-ak:test-locator",
        }),
      ],
      selectedStreamId: "stream-ak-1080",
    });

    const stream = providerResolveResultToStreamInfo({
      result,
      title: "Deferred Ak",
      subtitlePreference: "none",
    });

    expect(stream?.url).toBe("allmanga-ak:test-locator");
    expect(stream?.deferredLocator).toBe("allmanga-ak:test-locator");
    expect(stream?.url).not.toContain("https://ak-video.example");
  });

  test("keeps full subtitle inventory but only attaches configured or English fallback", () => {
    const result = makeResolveResult({
      subtitles: [
        makeSubtitleCandidate({
          id: "subtitle:ar",
          url: "https://subs.example/ar.vtt",
          language: "ar",
          label: "Arabic",
        }),
        makeSubtitleCandidate({
          id: "subtitle:en",
          url: "https://subs.example/en.vtt",
          language: "en",
          label: "English",
        }),
      ],
    });

    const frenchOnly = providerResolveResultToStreamInfo({
      result: {
        ...result,
        subtitles: [result.subtitles[0]!],
      },
      title: "Arabic Only",
      subtitlePreference: "fr",
    });
    expect(frenchOnly?.subtitle).toBeUndefined();
    expect(frenchOnly?.subtitleList).toHaveLength(1);

    const withFallback = providerResolveResultToStreamInfo({
      result,
      title: "Arabic + English",
      subtitlePreference: "fr",
    });
    expect(withFallback?.subtitle).toBe("https://subs.example/en.vtt");
    expect(withFallback?.subtitleList).toHaveLength(2);
  });
});

function makeSubtitleCandidate(overrides: Partial<SubtitleCandidate> = {}): SubtitleCandidate {
  return {
    id: "subtitle:test",
    providerId: "test-provider",
    url: "https://subs.example/sub.vtt",
    format: "vtt",
    source: "provider",
    confidence: 0.9,
    cachePolicy: {
      ttlClass: "subtitle-list",
      scope: "local",
      keyParts: ["test-provider", "subtitle"],
    },
    ...overrides,
  };
}

function makeResolveResult(
  overrides: Partial<ProviderResolveResult> & { streams?: StreamCandidate[] } = {},
): ProviderResolveResult {
  const streams: StreamCandidate[] = overrides.streams ?? [
    makeStream("stream-a-1080", "source-a", "https://cdn.example/a-1080.m3u8", 1080),
    makeStream("stream-b-720", "source-b", "https://cdn.example/b-720.m3u8", 720),
    makeStream("stream-b-1080", "source-b", "https://cdn.example/b-1080.m3u8", 1080),
  ];
  return {
    status: "resolved",
    providerId: "test-provider",
    selectedStreamId: overrides.selectedStreamId ?? "stream-a-1080",
    streams,
    subtitles: [],
    cachePolicy: streams[0]?.cachePolicy,
    trace: {
      id: "trace-test",
      startedAt: "2026-05-20T00:00:00.000Z",
      title: { id: "title-1", kind: "series", title: "Selected Source" },
      selectedProviderId: "test-provider",
      selectedStreamId: "stream-a-1080",
      cacheHit: false,
      steps: [],
      failures: [],
    },
    failures: [],
    ...overrides,
  };
}

function makeStream(
  id: string,
  sourceId: string,
  url: string | undefined,
  qualityRank: number,
  overrides: Partial<StreamCandidate> = {},
): StreamCandidate {
  return {
    id,
    providerId: "test-provider",
    sourceId,
    ...(url ? { url } : {}),
    protocol: "hls",
    container: "m3u8",
    qualityLabel: `${qualityRank}p`,
    qualityRank,
    confidence: 0.9,
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: ["test-provider", id],
    },
    ...overrides,
  };
}
