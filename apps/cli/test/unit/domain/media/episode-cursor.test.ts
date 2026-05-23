import { describe, expect, test } from "bun:test";

import {
  compareEpisodeCursors,
  isNormalEpisodeCursor,
  pickHighestEpisodeCursor,
  toEpisodeCursor,
} from "@/domain/media/episode-cursor";

describe("episode cursor", () => {
  test("orders normal season episodes without using recency", () => {
    expect(
      compareEpisodeCursors({ season: 1, episode: 6 }, { season: 1, episode: 2 }),
    ).toBeGreaterThan(0);
    expect(
      compareEpisodeCursors({ season: 2, episode: 1 }, { season: 1, episode: 12 }),
    ).toBeGreaterThan(0);
  });

  test("prefers absolute episode when both cursors have it", () => {
    expect(
      compareEpisodeCursors(
        { season: 1, episode: 4, absoluteEpisode: 13 },
        { season: 2, episode: 1, absoluteEpisode: 12 },
      ),
    ).toBeGreaterThan(0);
  });

  test("picks the highest watched cursor even when an older episode was updated later", () => {
    const highest = pickHighestEpisodeCursor([
      { season: 1, episode: 6, updatedAt: "2026-05-20T00:00:00.000Z" },
      { season: 1, episode: 2, updatedAt: "2026-05-23T00:00:00.000Z" },
    ]);

    expect(highest).toEqual({ season: 1, episode: 6 });
  });

  test("filters specials and episode zero from normal new-episode math", () => {
    expect(isNormalEpisodeCursor({ season: 1, episode: 1 })).toBe(true);
    expect(isNormalEpisodeCursor({ season: 0, episode: 1 })).toBe(false);
    expect(isNormalEpisodeCursor({ season: 1, episode: 0 })).toBe(false);
    expect(toEpisodeCursor({ season: 0, episode: 1 })).toBeUndefined();
  });
});
