import { describe, expect, test } from "bun:test";

import {
  boundYoutubeSubtitleTracks,
  buildYoutubeSubtitlePreferencePlan,
  toYoutubeSubtitlePreferenceTokens,
} from "../../src/youtube/subtitle-language";

describe("buildYoutubeSubtitlePreferencePlan", () => {
  test("prefers config language in mpv while attaching all yt-dlp subtitle tracks", () => {
    expect(buildYoutubeSubtitlePreferencePlan("en")).toEqual({
      mpvSlang: "en,eng,en.*,eng.*",
      ytdlpSubLangs: "all",
      preferLanguage: "en",
      statusHint: "YouTube subtitles · prefer English · all tracks attached",
    });
  });

  test("honors none and original modes", () => {
    expect(buildYoutubeSubtitlePreferencePlan("none")).toEqual({
      mpvSlang: "no",
      ytdlpSubLangs: null,
      preferLanguage: null,
      statusHint: null,
    });
    expect(buildYoutubeSubtitlePreferencePlan("original")).toEqual({
      mpvSlang: "orig",
      ytdlpSubLangs: "all",
      preferLanguage: "original",
      statusHint: "YouTube subtitles · prefer original · all tracks attached",
    });
  });

  test("defaults to all tracks when preference is unset", () => {
    expect(buildYoutubeSubtitlePreferencePlan(undefined)).toMatchObject({
      mpvSlang: null,
      ytdlpSubLangs: "all",
      statusHint: "YouTube subtitles · all tracks attached",
    });
  });
});

describe("toYoutubeSubtitlePreferenceTokens", () => {
  test("exposes mpv slang and yt-dlp all-tracks policy", () => {
    expect(toYoutubeSubtitlePreferenceTokens("en")).toEqual({
      mpvSlang: "en,eng,en.*,eng.*",
      ytdlpSubLangs: "all",
    });
    expect(toYoutubeSubtitlePreferenceTokens("none")).toEqual({
      mpvSlang: "no",
      ytdlpSubLangs: null,
    });
  });
});

describe("boundYoutubeSubtitleTracks", () => {
  type Track = { readonly language: string; readonly source: "manual" | "auto" };

  /** Shape of a real video: a couple of human tracks under ~157 machine translations. */
  const REAL_WORLD: readonly Track[] = [
    { language: "en", source: "manual" },
    { language: "ja", source: "manual" },
    { language: "en-orig", source: "auto" },
    { language: "en", source: "auto" },
    { language: "en-US", source: "auto" },
    ...Array.from({ length: 157 }, (_, index) => ({
      language: `mt${index}`,
      source: "auto" as const,
    })),
  ];

  test("keeps every human-authored track and drops the machine-translation flood", () => {
    const bounded = boundYoutubeSubtitleTracks(REAL_WORLD, "en");

    expect(bounded.filter((track) => track.source === "manual")).toHaveLength(2);
    expect(bounded.some((track) => track.language.startsWith("mt"))).toBe(false);
    expect(bounded).toHaveLength(5);
  });

  test("keeps the original-language track even when it is not the preferred language", () => {
    const bounded = boundYoutubeSubtitleTracks(REAL_WORLD, "de");
    expect(bounded.map((track) => track.language)).toContain("en-orig");
  });

  test("matches regional and ISO 639-2 spellings of the preferred language", () => {
    const tracks: readonly Track[] = [
      { language: "en-GB", source: "auto" },
      { language: "eng", source: "auto" },
      { language: "fr", source: "auto" },
    ];
    expect(boundYoutubeSubtitleTracks(tracks, "en").map((track) => track.language)).toEqual([
      "en-GB",
      "eng",
    ]);
  });

  test("falls back to English when no language is configured", () => {
    const tracks: readonly Track[] = [
      { language: "en", source: "auto" },
      { language: "fr", source: "auto" },
    ];
    expect(boundYoutubeSubtitleTracks(tracks, undefined).map((t) => t.language)).toEqual(["en"]);
  });

  test("attaches nothing when subtitles are turned off", () => {
    expect(boundYoutubeSubtitleTracks(REAL_WORLD, "none")).toEqual([]);
  });

  test("caps the inventory even if every track somehow qualifies", () => {
    const tracks: readonly Track[] = Array.from({ length: 200 }, (_, index) => ({
      language: `manual${index}`,
      source: "manual" as const,
    }));
    expect(boundYoutubeSubtitleTracks(tracks, "en")).toHaveLength(25);
  });
});
