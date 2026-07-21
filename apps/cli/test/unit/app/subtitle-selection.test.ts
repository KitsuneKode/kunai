import { describe, expect, test } from "bun:test";

import {
  choosePlaybackSubtitle,
  shouldAttemptLateSubtitleLookup,
} from "@/app/playback/subtitle-selection";
import type { StreamInfo } from "@/domain/types";

const BASE_STREAM: StreamInfo = {
  url: "https://cdn.example/stream.m3u8",
  headers: {},
  subtitle: "https://cdn.example/default.vtt",
  subtitleList: [
    { url: "https://cdn.example/en.vtt", language: "en", display: "English" },
    { url: "https://cdn.example/ar.vtt", language: "ar", display: "Arabic" },
  ],
  timestamp: Date.now(),
};

describe("choosePlaybackSubtitle", () => {
  test("disables subtitles when the user selected none", async () => {
    const result = await choosePlaybackSubtitle({
      stream: BASE_STREAM,
      subLang: "none",
      pickSubtitle: async () => "https://cdn.example/en.vtt",
    });

    expect(result.subtitle).toBeNull();
    expect(result.reason).toBe("disabled");
  });

  test("prefers the configured language from subtitle inventory for normal language modes", async () => {
    const result = await choosePlaybackSubtitle({
      stream: BASE_STREAM,
      subLang: "en",
      pickSubtitle: async () => null,
    });

    expect(result.subtitle).toBe("https://cdn.example/en.vtt");
    expect(result.reason).toBe("auto-selected");
  });

  test("does not attach unrelated inventory languages for automatic selection", async () => {
    const result = await choosePlaybackSubtitle({
      stream: {
        ...BASE_STREAM,
        subtitle: "https://cdn.example/ar.vtt",
        subtitleList: [{ url: "https://cdn.example/ar.vtt", language: "ar", display: "Arabic" }],
      },
      subLang: "fr",
      pickSubtitle: async () => null,
    });

    expect(result.subtitle).toBeNull();
    expect(result.reason).toBe("no-tracks");
    expect(result.availableTracks).toBe(1);
  });

  test("English fallback is still attached when configured language is missing", async () => {
    const result = await choosePlaybackSubtitle({
      stream: {
        ...BASE_STREAM,
        subtitle: undefined,
        subtitleList: [
          { url: "https://cdn.example/ar.vtt", language: "ar", display: "Arabic" },
          { url: "https://cdn.example/en.vtt", language: "en", display: "English" },
        ],
      },
      subLang: "fr",
      pickSubtitle: async () => null,
    });

    expect(result.subtitle).toBe("https://cdn.example/en.vtt");
    expect(result.reason).toBe("auto-selected");
  });

  test("prefers the configured language from subtitle inventory over a stale provider default", async () => {
    const result = await choosePlaybackSubtitle({
      stream: {
        ...BASE_STREAM,
        subtitle: "https://cdn.example/ar.vtt",
      },
      subLang: "en",
      pickSubtitle: async () => null,
    });

    expect(result.subtitle).toBe("https://cdn.example/en.vtt");
    expect(result.reason).toBe("auto-selected");
  });

  test("prefers built-in tracks over external tracks when both match the configured language", async () => {
    const result = await choosePlaybackSubtitle({
      stream: {
        ...BASE_STREAM,
        subtitle: "https://cdn.example/opensubtitles-en.vtt",
        subtitleList: [
          {
            url: "https://cdn.example/opensubtitles-en.vtt",
            language: "en",
            display: "English SDH",
            sourceKind: "external",
            sourceName: "opensubtitles",
            isHearingImpaired: true,
          },
          {
            url: "https://cdn.example/provider-en.vtt",
            language: "en",
            display: "English",
            sourceKind: "embedded",
            sourceName: "vidking",
          },
        ],
      },
      subLang: "en",
      pickSubtitle: async () => null,
    });

    expect(result.subtitle).toBe("https://cdn.example/provider-en.vtt");
    expect(result.reason).toBe("auto-selected");
  });

  test("uses interactive picking when interactive mode is enabled", async () => {
    const result = await choosePlaybackSubtitle({
      stream: BASE_STREAM,
      subLang: "interactive",
      pickSubtitle: async (tracks) => tracks[1]?.url ?? null,
    });

    expect(result.subtitle).toBe("https://cdn.example/ar.vtt");
    expect(result.reason).toBe("interactive-picked");
    expect(result.availableTracks).toBe(2);
  });

  test("falls back cleanly when interactive mode has no track list", async () => {
    const result = await choosePlaybackSubtitle({
      stream: {
        ...BASE_STREAM,
        subtitleList: undefined,
      },
      subLang: "interactive",
      pickSubtitle: async () => null,
    });

    expect(result.subtitle).toBe("https://cdn.example/default.vtt");
    expect(result.reason).toBe("no-tracks");
    expect(result.availableTracks).toBe(0);
  });

  test("does not ask for external subtitles when selected hardsub satisfies the preference", async () => {
    let pickerCalls = 0;
    const result = await choosePlaybackSubtitle({
      stream: {
        url: "https://cdn.example/hardsub.m3u8",
        headers: {},
        timestamp: Date.now(),
        providerResolveResult: {
          status: "resolved",
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
              audioLanguages: ["ja"],
              hardSubLanguage: "English",
              url: "https://cdn.example/hardsub.m3u8",
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
      },
      subLang: "en",
      pickSubtitle: async () => {
        pickerCalls += 1;
        return null;
      },
    });

    expect(result.subtitle).toBeNull();
    expect(result.reason).toBe("hardsub-satisfied");
    expect(pickerCalls).toBe(0);
  });
});

describe("shouldAttemptLateSubtitleLookup", () => {
  test("tries Wyzie when provider inventory exists but has no matching configured subtitle", () => {
    expect(
      shouldAttemptLateSubtitleLookup({
        stream: {
          ...BASE_STREAM,
          subtitle: undefined,
          subtitleList: [{ url: "https://cdn.example/ar.vtt", language: "ar", display: "Arabic" }],
        },
        requestedSubLang: "en",
        hasTmdbId: true,
      }).attempt,
    ).toBe(true);
  });

  test("unrelated inventory still allows late lookup when nothing was auto-attached", () => {
    const decision = shouldAttemptLateSubtitleLookup({
      stream: {
        ...BASE_STREAM,
        subtitle: undefined,
        subtitleList: [{ url: "https://cdn.example/ar.vtt", language: "ar", display: "Arabic" }],
      },
      requestedSubLang: "fr",
      hasTmdbId: true,
    });

    expect(decision.attempt).toBe(true);
    expect(decision.reason).toBe("needs-lookup");
    expect(decision.availableTracks).toBe(1);
  });

  test("skips Wyzie when provider inventory already satisfies the configured subtitle", () => {
    expect(
      shouldAttemptLateSubtitleLookup({
        stream: {
          ...BASE_STREAM,
          subtitle: "https://cdn.example/en.vtt",
        },
        requestedSubLang: "en",
        hasTmdbId: true,
      }).attempt,
    ).toBe(false);
  });

  test("skips late lookup without a proven TMDB id", () => {
    const decision = shouldAttemptLateSubtitleLookup({
      stream: {
        ...BASE_STREAM,
        subtitle: undefined,
        subtitleList: undefined,
      },
      requestedSubLang: "en",
      hasTmdbId: false,
    });

    expect(decision.attempt).toBe(false);
    expect(decision.reason).toBe("tmdb-id-missing");
  });
});
