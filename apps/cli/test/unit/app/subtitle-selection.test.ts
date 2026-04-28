import { describe, expect, test } from "bun:test";

import type { StreamInfo } from "@/domain/types";

import { choosePlaybackSubtitle } from "@/app/subtitle-selection";

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

  test("keeps the provider default subtitle for normal language modes", async () => {
    const result = await choosePlaybackSubtitle({
      stream: BASE_STREAM,
      subLang: "en",
      pickSubtitle: async () => null,
    });

    expect(result.subtitle).toBe("https://cdn.example/default.vtt");
    expect(result.reason).toBe("provider-default");
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
