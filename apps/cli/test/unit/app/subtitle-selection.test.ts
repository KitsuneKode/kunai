import { describe, expect, test } from "bun:test";

import { choosePlaybackSubtitle } from "@/app/subtitle-selection";
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

  test("uses interactive picking when fzf mode is enabled", async () => {
    const result = await choosePlaybackSubtitle({
      stream: BASE_STREAM,
      subLang: "fzf",
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
      subLang: "fzf",
      pickSubtitle: async () => null,
    });

    expect(result.subtitle).toBe("https://cdn.example/default.vtt");
    expect(result.reason).toBe("no-tracks");
    expect(result.availableTracks).toBe(0);
  });
});
