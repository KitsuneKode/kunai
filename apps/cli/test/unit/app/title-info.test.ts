import { expect, test } from "bun:test";

import { titleInfoFromSearchResult } from "@/app/title-info";
import type { SearchResult } from "@/domain/types";

test("titleInfoFromSearchResult carries provider metadata v2 fields into playback identity", () => {
  const result: SearchResult = {
    id: "anime-1",
    type: "series",
    title: "Provider Title",
    year: "2026",
    overview: "Provider overview",
    posterPath: "https://cdn.example/poster.jpg",
    episodeCount: 12,
    externalIds: { anilistId: "123", malId: "456" },
    release: { availableAt: "2026-05-19T12:30:00.000Z", status: "released" },
    artwork: {
      posterUrl: "https://cdn.example/native-poster.jpg",
      seekBarVttUrl: "https://cdn.example/seek.vtt",
    },
    languageEvidence: [
      {
        role: "hardsub",
        normalizedLanguage: "en",
        nativeLabel: "Hard Sub",
      },
    ],
  };

  const title = titleInfoFromSearchResult(result, "Display Title");

  expect(title.name).toBe("Display Title");
  expect(title.posterUrl).toBe("https://cdn.example/poster.jpg");
  expect(title.externalIds?.malId).toBe("456");
  expect(title.release?.status).toBe("released");
  expect(title.artwork?.seekBarVttUrl).toContain("seek.vtt");
  expect(title.languageEvidence?.[0]?.nativeLabel).toBe("Hard Sub");
});
