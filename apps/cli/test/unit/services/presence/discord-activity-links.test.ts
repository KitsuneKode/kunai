import { expect, test } from "bun:test";

import {
  buildBestCatalogLink,
  buildCatalogEpisodeLink,
  buildCatalogViewLink,
  buildDiscordActivityUrlFields,
  buildDiscordPosterAsset,
  buildDiscordPresenceButtons,
  buildPlayableShareUrlForActivity,
  buildPlayableWebUrlForActivity,
  buildShareRefForActivity,
} from "@/services/presence/discord-activity-links";

const baseActivity = {
  mode: "anime" as const,
  title: {
    id: "anilist:21",
    type: "series" as const,
    name: "One Piece",
    externalIds: { anilistId: "21" },
    posterUrl: "https://image.example/poster.jpg",
  },
  episode: { season: 1, episode: 1 },
  providerId: "allanime",
  startedAtMs: 1_000,
};

test("buildCatalogViewLink returns AniList for anime titles", () => {
  expect(buildCatalogViewLink({ mode: "anime", title: baseActivity.title })).toEqual({
    label: "View on AniList",
    url: "https://anilist.co/anime/21",
  });
});

test("buildCatalogEpisodeLink returns TMDB episode pages when possible", () => {
  expect(
    buildCatalogEpisodeLink({
      ...baseActivity,
      mode: "series",
      title: {
        id: "tmdb:1396",
        type: "series",
        name: "Breaking Bad",
        externalIds: { tmdbId: "1396" },
      },
      episode: { season: 4, episode: 9 },
    }),
  ).toEqual({
    label: "View episode on TMDB",
    url: "https://www.themoviedb.org/tv/1396/season/4/episode/9",
  });
});

/**
 * The play target used to reach Discord only as presence *text*, so the single
 * button repeated the catalog link and the card offered one destination under
 * two affordances. Discord refuses non-http(s) button URLs, so the play button
 * must carry the https web-share route rather than the `kunai://` ref.
 */
test("buildDiscordPresenceButtons leads with a play button distinct from the catalog link", () => {
  const buttons = buildDiscordPresenceButtons(baseActivity, "full");
  const playUrl = buildPlayableWebUrlForActivity(baseActivity, "full");

  expect(buttons).toEqual([
    { label: "Play on Kunai", url: playUrl as string },
    { label: "View on AniList", url: "https://anilist.co/anime/21" },
  ]);
  expect(buttons[0]?.url.startsWith("https://")).toBe(true);
  expect(buttons[0]?.url).not.toBe(buttons[1]?.url);
  expect(buttons.length).toBeLessThanOrEqual(2);
  expect(buildDiscordPresenceButtons(baseActivity, "private")).toEqual([]);
});

test("buildPlayableWebUrlForActivity yields an https handoff and stays private-safe", () => {
  const webUrl = buildPlayableWebUrlForActivity(baseActivity, "full");
  expect(webUrl?.startsWith("https://")).toBe(true);
  // Same playback target as the kunai:// ref, carried over a scheme Discord accepts.
  expect(buildPlayableShareUrlForActivity(baseActivity, "full")?.startsWith("kunai://")).toBe(true);
  expect(buildPlayableWebUrlForActivity(baseActivity, "private")).toBeNull();
});

test("buildDiscordPosterAsset uses HTTPS poster URLs for Discord large_image", () => {
  expect(buildDiscordPosterAsset(baseActivity.title)).toEqual({
    large_image: "https://image.example/poster.jpg",
    large_text: "One Piece",
  });
});

test("buildDiscordPosterAsset expands TMDB relative poster paths", () => {
  expect(
    buildDiscordPosterAsset({
      name: "Study Group",
      posterUrl: "/w500abc123.jpg",
    }),
  ).toEqual({
    large_image: "https://image.tmdb.org/t/p/w500/w500abc123.jpg",
    large_text: "Study Group",
  });
});

test("buildDiscordPosterAsset falls back to the kunai asset key", () => {
  expect(
    buildDiscordPosterAsset({
      name: "Demo",
      year: "2024",
    }),
  ).toEqual({
    large_image: "kunai",
    large_text: "Demo · 2024",
    fallbackReason: "missing-artwork",
  });
});

test("buildDiscordPosterAsset falls back to episode artwork", () => {
  expect(
    buildDiscordPosterAsset(
      { name: "Demo" },
      { artwork: { posterUrl: "https://image.example/episode.jpg" } },
    ),
  ).toEqual({
    large_image: "https://image.example/episode.jpg",
    large_text: "Demo",
  });
});

test("buildDiscordPosterAsset accepts title thumbnail artwork", () => {
  expect(
    buildDiscordPosterAsset({
      name: "Study Group",
      artwork: { thumbnailUrl: "https://image.example/study-group.jpg" },
    }),
  ).toEqual({
    large_image: "https://image.example/study-group.jpg",
    large_text: "Study Group",
  });
});

test("buildDiscordActivityUrlFields exposes clickable catalog links", () => {
  // An AniList-only title has no distinct episode page, so linking the state row
  // would point it at the same URL as the title row.
  expect(buildDiscordActivityUrlFields(baseActivity)).toEqual({
    details_url: "https://anilist.co/anime/21",
    playable_ref: "kunai://play?cat=anilist%3A21&kind=anime&s=1&e=1&src=allanime&n=One%20Piece",
  });
  expect(buildDiscordActivityUrlFields(baseActivity, "private")).toEqual({
    details_url: "https://anilist.co/anime/21",
  });
  expect(
    buildDiscordActivityUrlFields({
      ...baseActivity,
      mode: "series",
      title: {
        id: "tmdb:1396",
        type: "series",
        name: "Breaking Bad",
        externalIds: { tmdbId: "1396" },
      },
      episode: { season: 4, episode: 9 },
    }),
  ).toEqual({
    details_url: "https://www.themoviedb.org/tv/1396",
    state_url: "https://www.themoviedb.org/tv/1396/season/4/episode/9",
    playable_ref: "kunai://play?cat=tmdb%3A1396&kind=series&s=4&e=9&src=allanime&n=Breaking%20Bad",
  });
});

test("buildShareRefForActivity encodes catalog anchors from playback context", () => {
  expect(buildShareRefForActivity(baseActivity)).toEqual({
    anchor: { by: "catalog", ns: "anilist", id: "21" },
    kind: "anime",
    season: 1,
    episode: 1,
    title: "One Piece",
    hint: { providerId: "allanime" },
  });
  expect(buildPlayableShareUrlForActivity(baseActivity, "full")).toBe(
    "kunai://play?cat=anilist%3A21&kind=anime&s=1&e=1&src=allanime&n=One%20Piece",
  );
  expect(buildPlayableShareUrlForActivity(baseActivity, "private")).toBeNull();
});

test("buildBestCatalogLink prefers episode pages over series pages", () => {
  expect(
    buildBestCatalogLink({
      ...baseActivity,
      mode: "series",
      title: {
        id: "tmdb:1396",
        type: "series",
        name: "Breaking Bad",
        externalIds: { tmdbId: "1396" },
      },
      episode: { season: 1, episode: 1 },
    }),
  ).toEqual({
    label: "View episode on TMDB",
    url: "https://www.themoviedb.org/tv/1396/season/1/episode/1",
  });
});
