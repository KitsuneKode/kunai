import { expect, test } from "bun:test";

import {
  mapAnimeEpisodeToTmdbCoordinates,
  mapTmdbEpisodeToAnimeCoordinates,
} from "../src/episode-map";

test("anime absolute episode maps into the ARM-provided TMDB season", () => {
  expect(mapAnimeEpisodeToTmdbCoordinates({ season: 1, episode: 5 }, { tmdbSeason: 1 })).toEqual({
    season: 1,
    episode: 5,
  });
  expect(mapAnimeEpisodeToTmdbCoordinates({ season: 1, episode: 3 }, { tmdbSeason: 4 })).toEqual({
    season: 4,
    episode: 3,
  });
});

test("anime episode mapping fails closed without a season map", () => {
  expect(mapAnimeEpisodeToTmdbCoordinates({ season: 1, episode: 5 }, undefined)).toBeNull();
  expect(mapAnimeEpisodeToTmdbCoordinates({ season: 1 }, { tmdbSeason: 1 })).toBeNull();
});

test("tmdb episode maps back to the anime entry when the season matches the map", () => {
  expect(mapTmdbEpisodeToAnimeCoordinates({ season: 4, episode: 3 }, { tmdbSeason: 4 })).toEqual({
    season: 1,
    episode: 3,
  });
  expect(mapTmdbEpisodeToAnimeCoordinates({ season: 1, episode: 5 }, undefined)).toEqual({
    season: 1,
    episode: 5,
  });
});

test("tmdb episode mapping fails closed for unmapped later seasons", () => {
  expect(mapTmdbEpisodeToAnimeCoordinates({ season: 2, episode: 3 }, undefined)).toBeNull();
  expect(mapTmdbEpisodeToAnimeCoordinates({ season: 2, episode: 3 }, { tmdbSeason: 4 })).toBeNull();
});
