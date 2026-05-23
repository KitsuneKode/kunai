import { expect, test } from "bun:test";

import { buildKunaiPlaybackHandoffUrl, parseKunaiHandoffUrl } from "@/app/handoff-url";

test("parseKunaiHandoffUrl accepts search playback handoffs with local confirmation required", () => {
  expect(parseKunaiHandoffUrl("kunai://play?search=Dune&mode=anime")).toEqual({
    action: "play",
    search: "Dune",
    anime: true,
    requiresConfirmation: true,
  });
});

test("parseKunaiHandoffUrl accepts direct title and download handoffs", () => {
  expect(parseKunaiHandoffUrl("kunai://download?id=438631&type=movie")).toEqual({
    action: "download",
    id: "438631",
    type: "movie",
    requiresConfirmation: true,
  });
});

test("parseKunaiHandoffUrl rejects unsafe schemes and incomplete direct ids", () => {
  expect(parseKunaiHandoffUrl("https://example.com/play?search=Dune")).toBeNull();
  expect(parseKunaiHandoffUrl("javascript:alert(1)")).toBeNull();
  expect(parseKunaiHandoffUrl("kunai://play?id=438631&type=anime")).toBeNull();
});

test("buildKunaiPlaybackHandoffUrl prefers TMDB direct ids for series and movies", () => {
  expect(
    buildKunaiPlaybackHandoffUrl({
      mode: "series",
      title: {
        id: "tmdb:1396",
        type: "series",
        name: "Breaking Bad",
        externalIds: { tmdbId: "1396" },
      },
    }),
  ).toBe("kunai://play?id=1396&type=series");
});

test("buildKunaiPlaybackHandoffUrl uses anime search handoffs for AniList titles", () => {
  expect(
    buildKunaiPlaybackHandoffUrl({
      mode: "anime",
      title: {
        id: "anilist:21",
        type: "series",
        name: "One Piece",
        externalIds: { anilistId: "21" },
      },
    }),
  ).toBe("kunai://play?search=One%20Piece&mode=anime");
});
