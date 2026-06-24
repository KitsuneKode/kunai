import { expect, test } from "bun:test";

import { buildKunaiPlaybackHandoffUrl, parseKunaiHandoffUrl } from "@/app/bootstrap/handoff-url";

test("parseKunaiHandoffUrl accepts catalog-anchored playback handoffs", () => {
  expect(parseKunaiHandoffUrl("kunai://play?cat=anilist%3A21&kind=anime")).toEqual({
    action: "play",
    requiresConfirmation: true,
    ref: {
      anchor: { by: "catalog", ns: "anilist", id: "21" },
      kind: "anime",
    },
  });
});

test("parseKunaiHandoffUrl accepts direct title and download handoffs", () => {
  expect(parseKunaiHandoffUrl("kunai://download?cat=tmdb%3A438631&kind=movie")).toEqual({
    action: "download",
    requiresConfirmation: true,
    ref: {
      anchor: { by: "catalog", ns: "tmdb", id: "438631" },
      kind: "movie",
    },
  });
});

test("parseKunaiHandoffUrl rejects unsafe schemes and incomplete anchors", () => {
  expect(parseKunaiHandoffUrl("https://example.com/play?q=Dune")).toBeNull();
  expect(parseKunaiHandoffUrl("javascript:alert(1)")).toBeNull();
  expect(parseKunaiHandoffUrl("kunai://play?kind=anime")).toBeNull();
});

test("buildKunaiPlaybackHandoffUrl prefers TMDB catalog anchors for series and movies", () => {
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
  ).toBe("kunai://play?cat=tmdb%3A1396&kind=series&n=Breaking%20Bad");
});

test("buildKunaiPlaybackHandoffUrl uses AniList catalog anchors for anime titles", () => {
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
  ).toBe("kunai://play?cat=anilist%3A21&kind=anime&n=One%20Piece");
});
