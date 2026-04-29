import { describe, expect, test } from "bun:test";

import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import type { EpisodePickerOption, TitleInfo } from "@/domain/types";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

const seriesTitle: TitleInfo = {
  id: "series-1",
  name: "Example Series",
  type: "series",
};

const WATCHED_ENTRIES: HistoryEntry[] = [
  {
    title: "Example Series",
    type: "series",
    season: 2,
    episode: 5,
    timestamp: 3600,
    duration: 3600,
    completed: true,
    provider: "vidking",
    watchedAt: "2026-04-29T00:00:00.000Z",
  },
  {
    title: "Example Series",
    type: "series",
    season: 2,
    episode: 6,
    timestamp: 600,
    duration: 3600,
    completed: false,
    provider: "vidking",
    watchedAt: "2026-04-29T01:00:00.000Z",
  },
];

describe("buildPlaybackEpisodePickerOptions", () => {
  test("uses provider episode catalogs for anime and marks the current episode", async () => {
    const animeEpisodes: EpisodePickerOption[] = [
      { index: 1, label: "Episode 1", detail: "Source episode 1" },
      { index: 2, label: "Episode 2", detail: "Source episode 2" },
    ];

    const result = await buildPlaybackEpisodePickerOptions({
      title: seriesTitle,
      currentEpisode: { season: 1, episode: 2 },
      isAnime: true,
      animeEpisodes,
    });

    expect(result.subtitle).toBe("2 released episodes available");
    expect(result.options).toEqual([
      { value: "1:1", label: "Episode 1", detail: "Source episode 1" },
      { value: "1:2", label: "Episode 2  ·  current", detail: "Source episode 2" },
    ]);
  });

  test("falls back to episode count for anime when provider catalog is missing", async () => {
    const result = await buildPlaybackEpisodePickerOptions({
      title: { ...seriesTitle, episodeCount: 3 },
      currentEpisode: { season: 1, episode: 2 },
      isAnime: true,
    });

    expect(result.subtitle).toBe("3 episode slots available");
    expect(result.options.map((option) => option.value)).toEqual(["1:1", "1:2", "1:3"]);
    expect(result.options[1]?.label).toBe("Episode 2  ·  current");
  });

  test("loads season episodes for series playback", async () => {
    const result = await buildPlaybackEpisodePickerOptions({
      title: seriesTitle,
      currentEpisode: { season: 2, episode: 5 },
      isAnime: false,
      watchedEntries: WATCHED_ENTRIES,
      loadEpisodes: async () => [
        {
          number: 5,
          name: "The Current One",
          airDate: "2026-01-01",
          overview: "A test overview",
        },
        {
          number: 6,
          name: "The Next One",
          airDate: "",
          overview: "",
        },
      ],
    });

    expect(result.subtitle).toBe("Season 2  ·  2 episodes");
    expect(result.options).toEqual([
      {
        value: "2:5",
        label: "Episode 5  ·  The Current One  ·  current",
        detail: "watched  ·  2026-01-01  ·  A test overview",
      },
      {
        value: "2:6",
        label: "Episode 6  ·  The Next One",
        detail: "resume 10:00  ·  unknown year",
      },
    ]);
  });

  test("returns an empty picker for movies", async () => {
    const result = await buildPlaybackEpisodePickerOptions({
      title: { id: "movie-1", name: "Movie", type: "movie" },
      currentEpisode: { season: 1, episode: 1 },
      isAnime: false,
    });

    expect(result.options).toEqual([]);
    expect(result.subtitle).toBe("Episode picker is only available for episodic playback");
  });
});
