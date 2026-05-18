import { describe, expect, test } from "bun:test";

import {
  buildEpisodePickerOption,
  buildPlaybackEpisodePickerOptions,
  formatEpisodePickerSubtitle,
  renderEpisodeWatchProgressBar,
} from "@/app/playback-episode-picker";
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

describe("formatEpisodePickerSubtitle", () => {
  test("formats series context with completion percentage", () => {
    const subtitle = formatEpisodePickerSubtitle({
      seriesName: "Breaking Bad",
      season: 2,
      options: [
        { value: "1", label: "E01", tone: "success" },
        { value: "2", label: "E02", tone: "success" },
        { value: "3", label: "E03", tone: "info" },
        { value: "4", label: "E04" },
      ],
    });

    expect(subtitle).toBe("Breaking Bad  ·  S02  ·  4 eps  ·  50% complete");
  });

  test("omits completion when nothing is watched", () => {
    const subtitle = formatEpisodePickerSubtitle({
      seriesName: "Example Series",
      season: 1,
      options: [
        { value: "1", label: "E01" },
        { value: "2", label: "E02", tone: "info" },
      ],
    });

    expect(subtitle).toBe("Example Series  ·  S01  ·  2 eps");
  });
});

describe("renderEpisodeWatchProgressBar", () => {
  test("renders a ten-block watch bar", () => {
    expect(renderEpisodeWatchProgressBar(47)).toBe("[█████░░░░░]");
    expect(renderEpisodeWatchProgressBar(0)).toBe("[░░░░░░░░░░]");
    expect(renderEpisodeWatchProgressBar(100)).toBe("[██████████]");
  });
});

describe("buildEpisodePickerOption", () => {
  test("adds a progress bar for in-progress episodes", () => {
    const option = buildEpisodePickerOption({
      season: 2,
      episode: 6,
      label: "Episode 6  ·  The Next One",
      baseDetail: "unknown year",
      current: false,
      history: WATCHED_ENTRIES[1],
    });

    expect(option.detail).toBe("[██░░░░░░░░]  ·  resume 10:00  ·  17% watched  ·  unknown year");
    expect(option.tone).toBe("warning");
    expect(option.badge).toBe("17%");
  });

  test("marks the current episode with info tone", () => {
    const option = buildEpisodePickerOption({
      season: 1,
      episode: 2,
      label: "Episode 2",
      current: true,
    });

    expect(option.label).toBe("▶  Episode 2");
    expect(option.tone).toBe("info");
    expect(option.badge).toBeUndefined();
  });
});

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

    expect(result.subtitle).toBe("Example Series  ·  S01  ·  2 eps");
    expect(result.initialIndex).toBe(1);
    expect(result.options).toEqual([
      {
        value: "1:1",
        label: "Episode 1",
        detail: "Source episode 1",
        tone: undefined,
        badge: undefined,
      },
      {
        value: "1:2",
        label: "▶  Episode 2",
        detail: "Source episode 2",
        tone: "info",
        badge: undefined,
      },
    ]);
  });

  test("falls back to episode count for anime when provider catalog is missing", async () => {
    const result = await buildPlaybackEpisodePickerOptions({
      title: { ...seriesTitle, episodeCount: 3 },
      currentEpisode: { season: 1, episode: 2 },
      isAnime: true,
    });

    expect(result.subtitle).toBe("Example Series  ·  S01  ·  3 eps");
    expect(result.initialIndex).toBe(1);
    expect(result.options.map((option) => option.value)).toEqual(["1:1", "1:2", "1:3"]);
    expect(result.options[1]).toMatchObject({
      label: "▶  Episode 2",
      tone: "info",
      badge: undefined,
    });
  });

  test("loads season episodes for series playback", async () => {
    const realDateNow = Date.now;
    Date.now = () => Date.parse("2026-05-17T00:00:00.000Z");
    try {
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

      expect(result.subtitle).toBe("Example Series  ·  S02  ·  2 eps  ·  50% complete");
      expect(result.initialIndex).toBe(0);
      expect(result.options).toEqual([
        {
          value: "2:5",
          label: "▶  Episode 5  ·  The Current One",
          detail: "watched  ·  2w ago  ·  2026-01-01",
          tone: "success",
          badge: "watched",
        },
        {
          value: "2:6",
          label: "Episode 6  ·  The Next One",
          detail: "[██░░░░░░░░]  ·  resume 10:00  ·  17% watched  ·  unknown year",
          tone: "warning",
          badge: "17%",
        },
      ]);
    } finally {
      Date.now = realDateNow;
    }
  });

  test("returns an empty picker for movies", async () => {
    const result = await buildPlaybackEpisodePickerOptions({
      title: { id: "movie-1", name: "Movie", type: "movie" },
      currentEpisode: { season: 1, episode: 1 },
      isAnime: false,
    });

    expect(result.options).toEqual([]);
    expect(result.subtitle).toBe("Episode picker is only available for episodic playback");
    expect(result.initialIndex).toBe(0);
  });
});
