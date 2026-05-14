import { describe, expect, test } from "bun:test";

import {
  describeMediaPreference,
  describeSubtitleFallback,
} from "@/domain/media/media-preferences";
import {
  buildMediaTrackModel,
  describeStreamCandidateMediaDetail,
} from "@/domain/media/media-track-model";
import type { StreamInfo } from "@/domain/types";
import type { StreamCandidate, SubtitleCandidate } from "@kunai/types";

const streamCandidate: StreamCandidate = {
  id: "stream-1080",
  providerId: "vidking",
  sourceId: "source-a",
  protocol: "hls",
  container: "m3u8",
  audioLanguages: ["ja"],
  hardSubLanguage: "en",
  qualityLabel: "1080p",
  qualityRank: 1080,
  url: "https://cdn.example/1080.m3u8",
  headers: {},
  confidence: 0.9,
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: [],
  },
};

const subtitleCandidate: SubtitleCandidate = {
  id: "sub-en",
  providerId: "vidking",
  sourceId: "source-a",
  variantId: "variant-1080",
  url: "https://cdn.example/en.vtt",
  language: "en",
  source: "provider",
  confidence: 0.9,
  cachePolicy: {
    ttlClass: "subtitle-list",
    scope: "local",
    keyParts: [],
  },
};

describe("media preferences", () => {
  test("describes preference labels and subtitle fallback copy", () => {
    expect(describeMediaPreference({ kind: "audio", value: "original" })).toBe("Original audio");
    expect(describeMediaPreference({ kind: "subtitle", value: "none" })).toBe("Subtitles off");
    expect(
      describeSubtitleFallback({
        requested: "fr",
        availableLanguages: ["en", "ja"],
      }),
    ).toBe("Preferred subtitles unavailable; using English");
  });
});

describe("media track model", () => {
  test("separates provider inventory, selected stream, and active mpv state", () => {
    const stream: StreamInfo = {
      url: "https://cdn.example/1080.m3u8",
      headers: {},
      subtitle: "https://cdn.example/en.vtt",
      timestamp: Date.now(),
      providerResolveResult: {
        providerId: "vidking",
        selectedStreamId: "stream-1080",
        streams: [
          { ...streamCandidate, variantId: "variant-1080" },
          {
            ...streamCandidate,
            id: "stream-720",
            qualityLabel: "720p",
            qualityRank: 720,
            audioLanguages: ["en"],
            url: "https://cdn.example/720.m3u8",
          },
        ],
        sources: [
          {
            id: "source-a",
            providerId: "vidking",
            kind: "mirror",
            status: "selected",
            confidence: 0.9,
          },
        ],
        subtitles: [subtitleCandidate],
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

    const model = buildMediaTrackModel(stream, {
      streamId: "mpv-active",
      audioLanguage: "ja",
      subtitleLanguage: "en",
    });

    expect(model.provider).toMatchObject({
      sourceCount: 1,
      streamCount: 2,
      audioLanguages: ["ja", "en"],
      hardSubLanguages: ["en"],
      softSubtitleLanguages: ["en"],
    });
    expect(model.selected).toMatchObject({
      sourceId: "source-a",
      streamId: "stream-1080",
      qualityLabel: "1080p",
      subtitleLanguage: "en",
    });
    expect(model.active).toMatchObject({ streamId: "mpv-active" });
    expect(model.switching).toEqual({
      source: false,
      quality: true,
      subtitle: false,
      audio: true,
    });
  });

  test("describes provider media detail consistently for source and quality pickers", () => {
    expect(
      describeStreamCandidateMediaDetail({ ...streamCandidate, variantId: "variant-1080" }, [
        subtitleCandidate,
      ]),
    ).toBe("hls  ·  m3u8  ·  audio ja  ·  hardsub en  ·  soft subs en");
  });
});
