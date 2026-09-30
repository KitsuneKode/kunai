import { describe, expect, test } from "bun:test";

import { selectEpisodesForDownloadScope } from "@/services/download/download-scope-policy";

describe("download scope policy", () => {
  test("selects the next N remaining season episodes in order", () => {
    expect(
      selectEpisodesForDownloadScope({
        scope: { type: "next-n", count: 2 },
        currentEpisode: { season: 1, episode: 2 },
        seasonEpisodes: [
          { season: 1, episode: 5 },
          { season: 1, episode: 3 },
          { season: 2, episode: 1 },
          { season: 1, episode: 4 },
        ],
      }).map((episode) => episode.episode),
    ).toEqual([3, 4]);
  });

  test("dedupes manual episode selections without changing first-seen order", () => {
    expect(
      selectEpisodesForDownloadScope({
        scope: {
          type: "manual-selection",
          episodes: [
            { season: 1, episode: 3 },
            { season: 1, episode: 3 },
            { season: 1, episode: 2 },
          ],
        },
        currentEpisode: { season: 1, episode: 1 },
      }),
    ).toEqual([
      { season: 1, episode: 3 },
      { season: 1, episode: 2 },
    ]);
  });
});
