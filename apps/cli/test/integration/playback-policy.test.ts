import { describe, expect, test } from "bun:test";

import {
  didPlaybackEndNearNaturalEnd,
  getCompletionThresholdSeconds,
  getAutoAdvanceEpisode,
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/app/playback-policy";
import type { EpisodeInfo, PlaybackResult, TitleInfo } from "@/domain/types";

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

const CREDITS_TIMING = {
  tmdbId: "1396",
  type: "series" as const,
  intro: [],
  recap: [],
  credits: [
    { startMs: 0, endMs: 90_000 },
    { startMs: 1_200_000, endMs: null },
  ],
  preview: [],
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
    expect(availability.upcomingNext).toBeNull();
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
    expect(availability.upcomingNext).toBeNull();
    expect(availability.animeNextReleaseUnknown).toBe(false);
  });

  test("marks anime continuation unknown when list omits the next index despite count", async () => {
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: { season: 1, episode: 11 },
      isAnime: true,
      animeEpisodeCount: 12,
      animeEpisodes: [
        { index: 1, label: "Episode 1" },
        { index: 11, label: "Episode 11" },
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

    expect(availability.nextEpisode).toBeNull();
    expect(availability.animeNextReleaseUnknown).toBe(true);
  });

  test("treats anime as catalog-complete on the final declared episode", async () => {
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: { season: 1, episode: 12 },
      isAnime: true,
      animeEpisodeCount: 12,
      animeEpisodes: [
        { index: 1, label: "Episode 1" },
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

    expect(availability.nextEpisode).toBeNull();
    expect(availability.animeNextReleaseUnknown).toBe(false);
  });

  test("lists upcoming TMDB-catalog successor without using it as nextEpisode or autoplay", async () => {
    const loaders = {
      async loadSeasons() {
        return [1, 2] as const;
      },
      async loadEpisodes(_titleId: string, season: number) {
        if (season === 1) {
          return [
            { number: 6, name: "Six", airDate: "2020-01-01", overview: "" },
            { number: 7, name: "Seven", airDate: "2020-01-08", overview: "" },
            { number: 8, name: "Eight", airDate: "3020-01-01", overview: "" },
          ] as const;
        }

        return [{ number: 1, name: "Late premiere", airDate: "3020-06-01", overview: "" }] as const;
      },
    };

    const current = { season: 1, episode: 7 };
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: current,
      isAnime: false,
      loaders,
    });

    expect(availability.nextEpisode).toBeNull();
    expect(availability.upcomingNext).toEqual({
      season: 1,
      episode: 8,
      airDate: "3020-01-01",
      name: "Eight",
    });

    await expect(
      getAutoAdvanceEpisode(EOF_RESULT, SERIES_TITLE, current, true, availability),
    ).resolves.toBeNull();
  });

  test("finds catalog upcomingNext across a season boundary", async () => {
    const loaders = {
      async loadSeasons() {
        return [1, 2] as const;
      },
      async loadEpisodes(_titleId: string, season: number) {
        if (season === 1) {
          return [
            { number: 1, name: "A", airDate: "2020-01-01", overview: "" },
            { number: 2, name: "B", airDate: "2020-01-08", overview: "" },
          ] as const;
        }

        return [
          { number: 1, name: "Late S2 opener", airDate: "3099-05-05", overview: "" },
        ] as const;
      },
    };

    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: { season: 1, episode: 2 },
      isAnime: false,
      loaders,
    });

    expect(availability.nextEpisode).toBeNull();
    expect(availability.upcomingNext).toEqual({
      season: 2,
      episode: 1,
      airDate: "3099-05-05",
      name: "Late S2 opener",
    });
  });

  test("does not attach upcomingNext when a nearer released successor is playable", async () => {
    const loaders = {
      async loadSeasons() {
        return [1] as const;
      },
      async loadEpisodes() {
        return [
          { number: 7, name: "", airDate: "2020-01-01", overview: "" },
          { number: 8, name: "", airDate: "2024-06-01", overview: "" },
          { number: 9, name: "", airDate: "3020-01-01", overview: "" },
        ] as const;
      },
    };

    const current = { season: 1, episode: 7 };
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: current,
      isAnime: false,
      loaders,
    });

    expect(availability.nextEpisode).toMatchObject({
      season: 1,
      episode: 8,
    });
    expect(availability.upcomingNext).toBeNull();

    await expect(
      getAutoAdvanceEpisode(EOF_RESULT, SERIES_TITLE, current, true, availability),
    ).resolves.toMatchObject({ season: 1, episode: 8 });
  });

  test("surfaces unreleased instalment once the latest released slot is exhausted", async () => {
    const loaders = {
      async loadSeasons() {
        return [1] as const;
      },
      async loadEpisodes() {
        return [
          { number: 7, name: "", airDate: "2020-01-01", overview: "" },
          { number: 8, name: "", airDate: "2024-06-01", overview: "" },
          { number: 9, name: "", airDate: "3020-01-01", overview: "" },
        ] as const;
      },
    };

    const current = { season: 1, episode: 8 };
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: current,
      isAnime: false,
      loaders,
    });

    expect(availability.nextEpisode).toBeNull();
    expect(availability.upcomingNext).toMatchObject({ season: 1, episode: 9 });
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
        upcomingNext: null,
        animeNextReleaseUnknown: false,
      }),
    ).resolves.toBeNull();
  });

  test("does not auto-advance when playback does not end at eof", async () => {
    await expect(
      getAutoAdvanceEpisode(
        { watchedSeconds: 811, duration: 1440, endReason: "quit" },
        SERIES_TITLE,
        CURRENT_EPISODE,
        true,
        {
          previousEpisode: null,
          nextEpisode: { season: 1, episode: 8 },
          nextSeasonEpisode: null,
          upcomingNext: null,
          animeNextReleaseUnknown: false,
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
        upcomingNext: null,
        animeNextReleaseUnknown: false,
      }),
    ).resolves.toBeNull();
  });

  test("still auto-advances when playback exits near the natural end of the episode", async () => {
    await expect(
      getAutoAdvanceEpisode(
        { watchedSeconds: 1742, duration: 1745, endReason: "quit" },
        SERIES_TITLE,
        CURRENT_EPISODE,
        true,
        {
          previousEpisode: null,
          nextEpisode: { season: 1, episode: 8 },
          nextSeasonEpisode: null,
          upcomingNext: null,
          animeNextReleaseUnknown: false,
        },
      ),
    ).resolves.toEqual({ season: 1, episode: 8 });
  });

  test("uses credits timing as the near-end threshold when available", async () => {
    await expect(
      getAutoAdvanceEpisode(
        { watchedSeconds: 1201, duration: 1500, endReason: "quit" },
        SERIES_TITLE,
        CURRENT_EPISODE,
        true,
        {
          previousEpisode: null,
          nextEpisode: { season: 1, episode: 8 },
          nextSeasonEpisode: null,
          upcomingNext: null,
          animeNextReleaseUnknown: false,
        },
        CREDITS_TIMING,
      ),
    ).resolves.toEqual({ season: 1, episode: 8 });
  });

  test("auto-advances across a season boundary when playback ends near eof", async () => {
    const availability = await resolveEpisodeAvailability({
      title: SERIES_TITLE,
      currentEpisode: CURRENT_EPISODE,
      isAnime: false,
      loaders: SERIES_LOADERS,
    });

    await expect(
      getAutoAdvanceEpisode(
        { watchedSeconds: 1438, duration: 1440, endReason: "quit" },
        SERIES_TITLE,
        CURRENT_EPISODE,
        true,
        availability,
      ),
    ).resolves.toEqual({
      season: 2,
      episode: 1,
      name: "Season Two",
      airDate: "2025",
      overview: "Return",
    });
  });

  test("does not auto-advance when provider navigation points back to the current episode", async () => {
    await expect(
      getAutoAdvanceEpisode(EOF_RESULT, SERIES_TITLE, CURRENT_EPISODE, true, {
        previousEpisode: { season: 1, episode: 6 },
        nextEpisode: { season: 1, episode: 7 },
        nextSeasonEpisode: null,
        upcomingNext: null,
        animeNextReleaseUnknown: false,
      }),
    ).resolves.toBeNull();
  });
});

describe("completion thresholds", () => {
  test("prefers the later credits start over opening credits", () => {
    expect(getCompletionThresholdSeconds(1500, CREDITS_TIMING)).toBe(1200);
  });

  test("falls back to the last five seconds when timing metadata is absent", () => {
    expect(getCompletionThresholdSeconds(1500)).toBe(1495);
    expect(
      didPlaybackEndNearNaturalEnd({
        watchedSeconds: 1495,
        duration: 1500,
        endReason: "quit",
      }),
    ).toBe(true);
  });
});

describe("toEpisodeNavigationState", () => {
  test("surfaces the actual next and next-season labels", () => {
    const navigation = toEpisodeNavigationState(SERIES_TITLE.type, {
      previousEpisode: { season: 1, episode: 6 },
      nextEpisode: { season: 2, episode: 1 },
      nextSeasonEpisode: { season: 2, episode: 1 },
      upcomingNext: null,
      animeNextReleaseUnknown: false,
    });

    expect(navigation.hasNext).toBe(true);
    expect(navigation.nextLabel).toBe("S02E01");
    expect(navigation.nextSeasonLabel).toBe("S02E01");
  });

  test("explains anime catalog tail without fabricating TMDB schedules", () => {
    const navigation = toEpisodeNavigationState(
      SERIES_TITLE.type,
      {
        previousEpisode: { season: 1, episode: 11 },
        nextEpisode: null,
        nextSeasonEpisode: null,
        upcomingNext: null,
        animeNextReleaseUnknown: false,
      },
      { isAnime: true },
    );

    expect(navigation.hasNext).toBe(false);
    expect(navigation.nextUnavailableReason).toContain("Anime release timing");
  });

  test("explains uncertain anime next when the catalog cannot confirm a successor", () => {
    const navigation = toEpisodeNavigationState(
      SERIES_TITLE.type,
      {
        previousEpisode: { season: 1, episode: 5 },
        nextEpisode: null,
        nextSeasonEpisode: null,
        upcomingNext: null,
        animeNextReleaseUnknown: true,
      },
      { isAnime: true },
    );

    expect(navigation.hasNext).toBe(false);
    expect(navigation.nextUnavailableReason).toContain("(release timing is unknown)");
  });

  test("notes TMDB-upcoming instalment when next navigation is exhausted", () => {
    const navigation = toEpisodeNavigationState(
      SERIES_TITLE.type,
      {
        previousEpisode: { season: 1, episode: 12 },
        nextEpisode: null,
        nextSeasonEpisode: null,
        upcomingNext: {
          season: 2,
          episode: 1,
          airDate: "3099-11-02",
          name: "Pilot",
        },
        animeNextReleaseUnknown: false,
      },
      { isAnime: false },
    );

    expect(navigation.hasNext).toBe(false);
    expect(navigation.hasUpcomingNext).toBe(true);
    expect(navigation.upcomingNextLabel).toBe("S02E01");
    expect(navigation.nextUnavailableReason).toContain("S02E01");
    expect(navigation.nextUnavailableReason).toContain("not out yet");
    expect(navigation.nextUnavailableReason).toContain("Pilot");
  });
});
