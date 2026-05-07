import { describe, expect, test } from "bun:test";

import { resolveStartingEpisodeChoice } from "@/session-flow";

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
