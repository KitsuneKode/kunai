import { describe, expect, test } from "bun:test";

import {
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
