import { describe, expect, test } from "bun:test";

import {
  normalizeAutoDownloadNextCount,
  resolveAutoDownloadScope,
  selectEpisodesForDownloadScope,
} from "@/services/download/download-scope-policy";

describe("download scope policy", () => {
  test("keeps auto-download disabled by default", () => {
    expect(resolveAutoDownloadScope({ mode: "off" })).toBeNull();
  });

  test("maps next mode to one episode unless next-count is explicitly raised", () => {
    expect(resolveAutoDownloadScope({ mode: "next" })).toEqual({ type: "next-episode" });
    expect(resolveAutoDownloadScope({ mode: "next", nextCount: 3 })).toEqual({
      type: "next-n",
      count: 3,
    });
  });

  test("clamps next-count to a bounded opt-in batch size", () => {
    expect(normalizeAutoDownloadNextCount(-1)).toBe(1);
    expect(normalizeAutoDownloadNextCount(200)).toBe(24);
    expect(normalizeAutoDownloadNextCount(2.8)).toBe(2);
  });

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
