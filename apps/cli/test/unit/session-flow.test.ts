import { describe, expect, test } from "bun:test";

import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { resolveMovieStartingChoice, resolveStartingEpisodeChoice } from "@/session-flow";

function movieHistory(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Dune",
    type: "movie",
    season: 1,
    episode: 1,
    timestamp: 2400,
    duration: 9000,
    completed: false,
    provider: "vidking",
    watchedAt: "2026-05-06T05:00:00.000Z",
    ...patch,
  };
}

describe("starting episode selection", () => {
  test("terminal resume choice seeks directly without asking the mpv bridge again", () => {
    const selection = resolveStartingEpisodeChoice({
      choice: "resume",
      isAnime: false,
      history: {
        title: "Breaking Bad",
        type: "series",
        season: 4,
        episode: 2,
        timestamp: 1334,
        duration: 2860,
        completed: false,
        provider: "vidking",
        watchedAt: "2026-05-06T05:00:00.000Z",
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
        title: "Breaking Bad",
        type: "series",
        season: 4,
        episode: 2,
        timestamp: 1334,
        duration: 2860,
        completed: false,
        provider: "vidking",
        watchedAt: "2026-05-06T05:00:00.000Z",
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
    expect(resolveMovieStartingChoice("resume", movieHistory({ timestamp: 2400 }))).toEqual({
      season: 1,
      episode: 1,
      startAt: 2400,
      suppressResumePrompt: true,
    });
  });

  test("restart plays the movie from the beginning with no resume offer", () => {
    expect(resolveMovieStartingChoice("restart", movieHistory({ timestamp: 2400 }))).toEqual({
      season: 1,
      episode: 1,
      startAt: 0,
    });
  });
});
