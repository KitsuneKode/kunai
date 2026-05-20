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

function makeResolveResult(): ProviderResolveResult {
  const streams: StreamCandidate[] = [
    makeStream("stream-a-1080", "source-a", "https://cdn.example/a-1080.m3u8", 1080),
    makeStream("stream-b-720", "source-b", "https://cdn.example/b-720.m3u8", 720),
    makeStream("stream-b-1080", "source-b", "https://cdn.example/b-1080.m3u8", 1080),
  ];
  return {
    status: "resolved",
    providerId: "test-provider",
    selectedStreamId: "stream-a-1080",
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
  };
}

function makeStream(
  id: string,
  sourceId: string,
  url: string,
  qualityRank: number,
): StreamCandidate {
  return {
    id,
    providerId: "test-provider",
    sourceId,
    url,
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
  };
}
