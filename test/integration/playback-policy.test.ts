import { describe, expect, test } from "bun:test";

import type { EpisodeInfo, PlaybackResult, TitleInfo } from "@/domain/types";

import {
  getAutoAdvanceEpisode,
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/app/playback-policy";

const SERIES_TITLE: TitleInfo = {
  id: "demo-series",
  type: "series",
  name: "Demo Series",
};

const MOVIE_TITLE: TitleInfo = {
  id: "demo-movie",
  type: "movie",
  name: "Demo Movie",
};

const CURRENT_EPISODE: EpisodeInfo = {
  season: 1,
  episode: 7,
};

const EOF_RESULT: PlaybackResult = {
  watchedSeconds: 1440,
  duration: 1440,
  endReason: "eof",
};

const SERIES_LOADERS = {
  async loadSeasons() {
    return [1, 2] as const;
  },
  async loadEpisodes(_titleId: string, season: number) {
    if (season === 1) {
      return [
        { number: 6, name: "Six", airDate: "2024", overview: "Six" },
        { number: 7, name: "Seven", airDate: "2024", overview: "Seven" },
      ] as const;
    }

    return [{ number: 1, name: "Season Two", airDate: "2025", overview: "Return" }] as const;
  },
};

describe("resolveEpisodeAvailability", () => {
  test("crosses into the next season when the current season is finished", async () => {
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: CURRENT_EPISODE,
      isAnime: false,
      loaders: SERIES_LOADERS,
    });

    expect(availability.nextEpisode).toEqual({
      season: 2,
      episode: 1,
      name: "Season Two",
      airDate: "2025",
      overview: "Return",
    });
    expect(availability.nextSeasonEpisode?.season).toBe(2);
    expect(availability.previousEpisode?.episode).toBe(6);
  });

  test("uses provider episode options for anime autoplay and boundaries", async () => {
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: { season: 1, episode: 11 },
      isAnime: true,
      animeEpisodeCount: 12,
      animeEpisodes: [
        { index: 1, label: "Episode 1" },
        { index: 11, label: "Episode 11" },
        { index: 12, label: "Episode 12" },
      ],
      loaders: {
        async loadSeasons() {
          return [];
        },
        async loadEpisodes() {
          return [];
        },
      },
    });

    expect(availability.nextEpisode).toEqual({ season: 1, episode: 12 });
    expect(availability.previousEpisode).toEqual({ season: 1, episode: 1 });
    expect(availability.nextSeasonEpisode).toBeNull();
  });
});

describe("getAutoAdvanceEpisode", () => {
  test("advances to the next available episode when auto-next is enabled and playback ends at eof", async () => {
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: CURRENT_EPISODE,
      isAnime: false,
      loaders: SERIES_LOADERS,
    });

    await expect(
      getAutoAdvanceEpisode(EOF_RESULT, SERIES_TITLE, CURRENT_EPISODE, true, availability),
    ).resolves.toEqual({
      season: 2,
      episode: 1,
      name: "Season Two",
      airDate: "2025",
      overview: "Return",
    });
  });

  test("stops autoplay when there is no later released episode", async () => {
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: { season: 2, episode: 1 },
      isAnime: false,
      loaders: {
        async loadSeasons() {
          return [1, 2] as const;
        },
        async loadEpisodes(_titleId: string, season: number) {
          return season === 2
            ? ([{ number: 1, name: "Season Two", airDate: "2025", overview: "Return" }] as const)
            : ([] as const);
        },
      },
    });

    await expect(
      getAutoAdvanceEpisode(
        EOF_RESULT,
        SERIES_TITLE,
        { season: 2, episode: 1 },
        true,
        availability,
      ),
    ).resolves.toBeNull();
  });

  test("does not auto-advance when the title is a movie", async () => {
    await expect(
      getAutoAdvanceEpisode(EOF_RESULT, MOVIE_TITLE, CURRENT_EPISODE, true, {
        previousEpisode: null,
        nextEpisode: { season: 1, episode: 8 },
        nextSeasonEpisode: null,
      }),
    ).resolves.toBeNull();
  });

  test("does not auto-advance when playback does not end at eof", async () => {
    await expect(
      getAutoAdvanceEpisode(
        { ...EOF_RESULT, endReason: "quit" },
        SERIES_TITLE,
        CURRENT_EPISODE,
        true,
        {
          previousEpisode: null,
          nextEpisode: { season: 1, episode: 8 },
          nextSeasonEpisode: null,
        },
      ),
    ).resolves.toBeNull();
  });

  test("does not auto-advance when the setting is disabled", async () => {
    await expect(
      getAutoAdvanceEpisode(EOF_RESULT, SERIES_TITLE, CURRENT_EPISODE, false, {
        previousEpisode: null,
        nextEpisode: { season: 1, episode: 8 },
        nextSeasonEpisode: null,
      }),
    ).resolves.toBeNull();
  });
});

describe("toEpisodeNavigationState", () => {
  test("surfaces the actual next and next-season labels", () => {
    const navigation = toEpisodeNavigationState(SERIES_TITLE.type, {
      previousEpisode: { season: 1, episode: 6 },
      nextEpisode: { season: 2, episode: 1 },
      nextSeasonEpisode: { season: 2, episode: 1 },
    });

    expect(navigation.hasNext).toBe(true);
    expect(navigation.nextLabel).toBe("S02E01");
    expect(navigation.nextSeasonLabel).toBe("S02E01");
  });
});
