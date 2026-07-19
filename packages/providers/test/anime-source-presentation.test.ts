import { describe, expect, test } from "bun:test";

import {
  allmangaSubtitleMode,
  animeQualityFields,
  formatAnimeSourceArchetype,
  formatAnimeSourceDetail,
  formatAnimeSourceLabel,
  miruroSubtitleDeliveryToMode,
} from "../src/shared/anime-source-presentation";

describe("anime source presentation", () => {
  test("formats Sub/Dub · Server · subtitle mode consistently", () => {
    expect(
      formatAnimeSourceLabel({
        audio: "sub",
        serverLabel: "Kiwi",
        subtitleMode: "hard",
      }),
    ).toBe("Sub · Kiwi · hard sub");
    expect(
      formatAnimeSourceLabel({
        audio: "dub",
        serverLabel: "default",
        subtitleMode: "soft",
      }),
    ).toBe("Dub · Default · soft sub");
    // Already-human labels keep their casing (do not re-title-case "hardsub").
    expect(
      formatAnimeSourceLabel({
        audio: "sub",
        serverLabel: "Kiwi hardsub",
        subtitleMode: "soft",
      }),
    ).toBe("Sub · Kiwi hardsub · soft sub");
  });

  test("formats hybrid Miruro detail without the character/server token", () => {
    expect(formatAnimeSourceDetail({ audio: "sub", subtitleMode: "hard" })).toBe("Sub · hard sub");
    expect(formatAnimeSourceDetail({ audio: "dub", subtitleMode: "unknown" })).toBe(
      "Dub · subtitles unknown",
    );
  });

  test("quality fields normalize auto and height ranks for both anime providers", () => {
    expect(animeQualityFields("1080p")).toEqual({ qualityLabel: "1080p", qualityRank: 1080 });
    expect(animeQualityFields("1080")).toEqual({ qualityLabel: "1080p", qualityRank: 1080 });
    expect(animeQualityFields("auto").qualityRank).toBe(1080);
    expect(animeQualityFields("default").qualityRank).toBe(1080);
    expect(animeQualityFields(undefined, 720)).toEqual({ qualityLabel: "720p", qualityRank: 720 });
    // Prefer explicit quality string over fallback height when both exist.
    expect(animeQualityFields("480", 1080)).toEqual({ qualityLabel: "480p", qualityRank: 480 });
  });

  test("maps provider-specific subtitle delivery enums onto shared modes", () => {
    expect(miruroSubtitleDeliveryToMode("hardcoded")).toBe("hard");
    expect(miruroSubtitleDeliveryToMode("embedded")).toBe("soft");
    expect(allmangaSubtitleMode({ audio: "sub", hasExternalSubtitles: false })).toBe("hard");
    expect(allmangaSubtitleMode({ audio: "sub", hasExternalSubtitles: true })).toBe("soft");
  });

  test("archetype stays short and audio-aware", () => {
    expect(formatAnimeSourceArchetype({ audio: "sub" })).toBe("Japanese · hardsub");
    expect(formatAnimeSourceArchetype({ audio: "dub", detail: "Bocchi" })).toBe("Bocchi · dub");
  });
});
