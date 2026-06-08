import { expect, test } from "bun:test";

import {
  buildBestCatalogLink,
  buildCatalogEpisodeLink,
  buildCatalogViewLink,
  buildDiscordActivityUrlFields,
  buildDiscordPosterAsset,
  buildDiscordPresenceButtons,
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

test("buildDiscordPresenceButtons only exposes catalog links", () => {
  expect(buildDiscordPresenceButtons(baseActivity, "full")).toEqual([
    { label: "View on AniList", url: "https://anilist.co/anime/21" },
  ]);
  expect(buildDiscordPresenceButtons(baseActivity, "private")).toEqual([]);
});

test("buildDiscordPosterAsset uses HTTPS poster URLs for Discord large_image", () => {
  expect(buildDiscordPosterAsset(baseActivity.title)).toEqual({
    large_image: "https://image.example/poster.jpg",
    large_text: "One Piece",
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

test("buildDiscordActivityUrlFields exposes clickable catalog links", () => {
  expect(buildDiscordActivityUrlFields(baseActivity)).toEqual({
    details_url: "https://anilist.co/anime/21",
    state_url: "https://anilist.co/anime/21",
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
  });
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
