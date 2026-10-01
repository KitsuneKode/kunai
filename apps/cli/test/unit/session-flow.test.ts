import { describe, expect, test } from "bun:test";

import {
  chooseEpisodeFromMetadata,
  resolveMovieStartingChoice,
  resolveStartingEpisodeChoice,
} from "@/session-flow";
import type { HistoryProgress } from "@kunai/storage";

describe("episode selection outcome", () => {
  /**
   * The catalog failing and the user pressing Esc used to both return `null`, so
   * callers unwound identically: picking "Pick episode" during a TMDB outage
   * dropped the user back into History with nothing said about why. The reason
   * has to survive far enough for a caller to show it.
   */
  test("reports a missing season list as unavailable, not as a cancel", async () => {
    const outcome = await chooseEpisodeFromMetadata({
      currentId: "42",
      isAnime: false,
      currentSeason: 1,
      currentEpisode: 1,
      loaders: { loadSeasons: async () => ({ seasons: null, episodes: null }) },
    });

    expect(outcome.kind).toBe("unavailable");
    expect(outcome.kind === "unavailable" && outcome.reason.length).toBeGreaterThan(0);
    // No failure kind attached — the honest fallback names no cause.
    expect(outcome.kind === "unavailable" && outcome.reason).toContain("unexpected error");
  });

  test("names the transport cause instead of guessing 'check your connection'", async () => {
    const outcome = await chooseEpisodeFromMetadata({
      currentId: "42",
      isAnime: false,
      currentSeason: 1,
      currentEpisode: 1,
      loaders: {
        loadSeasons: async () => ({ seasons: null, episodes: null, failure: "unreachable" }),
      },
    });

    expect(outcome.kind).toBe("unavailable");
    expect(outcome.kind === "unavailable" && outcome.reason).toContain(
      "Could not reach the episode catalog",
    );
  });

  test("a 404 is the catalog answering, not an outage", async () => {
    const outcome = await chooseEpisodeFromMetadata({
      currentId: "42",
      isAnime: false,
      currentSeason: 1,
      currentEpisode: 1,
      loaders: {
        loadSeasons: async () => ({ seasons: null, episodes: null, failure: "not-found" }),
      },
    });

    expect(outcome.kind).toBe("unavailable");
    expect(outcome.kind === "unavailable" && outcome.reason).toContain("no record of this title");
  });

  test("a successful read with no seasons says so — not 'check your connection'", async () => {
    const outcome = await chooseEpisodeFromMetadata({
      currentId: "42",
      isAnime: false,
      currentSeason: 1,
      currentEpisode: 1,
      loaders: {
        loadSeasons: async () => ({ seasons: null, episodes: null, failure: "empty" }),
      },
    });

    expect(outcome.kind).toBe("unavailable");
    expect(outcome.kind === "unavailable" && outcome.reason).toContain("lists no playable seasons");
  });

  test("seasons loaded but the episode read failed — a failure, not a cancel", async () => {
    const outcome = await chooseEpisodeFromMetadata({
      currentId: "42",
      isAnime: false,
      currentSeason: 1,
      currentEpisode: 1,
      loaders: {
        loadSeasons: async () => ({
          seasons: [1],
          episodes: null,
          episodesFailure: "upstream",
        }),
      },
    });

    expect(outcome.kind).toBe("unavailable");
    expect(outcome.kind === "unavailable" && outcome.reason).toContain("answered with an error");
  });

  test("a lone season with no released episodes is availability, not a silent Esc", async () => {
    const outcome = await chooseEpisodeFromMetadata({
      currentId: "42",
      isAnime: false,
      currentSeason: 1,
      currentEpisode: 1,
      loaders: {
        loadSeasons: async () => ({ seasons: [1], episodes: [] }),
      },
    });

    expect(outcome.kind).toBe("unavailable");
    expect(outcome.kind === "unavailable" && outcome.reason).toContain("no released episodes");
  });
});

function movieHistory(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "x",
    title: "Dune",
    mediaKind: "movie",
    season: 1,
    episode: 1,
    positionSeconds: 2400,
    durationSeconds: 9000,
    completed: false,
    providerId: "vidking",
    updatedAt: "2026-05-06T05:00:00.000Z",
    createdAt: "2026-05-06T05:00:00.000Z",
    ...patch,
  };
}

describe("starting episode selection", () => {
  test("terminal resume choice seeks directly without asking the mpv bridge again", () => {
    const selection = resolveStartingEpisodeChoice({
      choice: "resume",
      isAnime: false,
      history: {
        key: "k",
        titleId: "x",
        title: "Breaking Bad",
        mediaKind: "series",
        season: 4,
        episode: 2,
        positionSeconds: 1334,
        durationSeconds: 2860,
        completed: false,
        providerId: "vidking",
        updatedAt: "2026-05-06T05:00:00.000Z",
        createdAt: "2026-05-06T05:00:00.000Z",
      },
      nextEpisode: { season: 4, episode: 3 },
    });

    expect(selection).toEqual({
      season: 4,
      episode: 2,
      startAt: 1334,
      suppressResumePrompt: true,
    });
  });

  test("terminal restart choice starts at zero but preserves a manual resume offer", () => {
    const selection = resolveStartingEpisodeChoice({
      choice: "restart",
      isAnime: false,
      history: {
        key: "k",
        titleId: "x",
        title: "Breaking Bad",
        mediaKind: "series",
        season: 4,
        episode: 2,
        positionSeconds: 1334,
        durationSeconds: 2860,
        completed: false,
        providerId: "vidking",
        updatedAt: "2026-05-06T05:00:00.000Z",
        createdAt: "2026-05-06T05:00:00.000Z",
      },
      nextEpisode: { season: 4, episode: 3 },
    });

    expect(selection).toEqual({
      season: 4,
      episode: 2,
      startAt: 1334,
    });
  });
});

describe("movie starting point", () => {
  test("resume seeks directly to the saved position without re-prompting", () => {
    expect(resolveMovieStartingChoice("resume", movieHistory({ positionSeconds: 2400 }))).toEqual({
      season: 1,
      episode: 1,
      startAt: 2400,
      suppressResumePrompt: true,
    });
  });

  test("restart plays the movie from the beginning with no resume offer", () => {
    expect(resolveMovieStartingChoice("restart", movieHistory({ positionSeconds: 2400 }))).toEqual({
      season: 1,
      episode: 1,
      startAt: 0,
    });
  });
});
