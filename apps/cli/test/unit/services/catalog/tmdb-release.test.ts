import { describe, expect, test } from "bun:test";

import {
  filterPlayableEpisodes,
  formatTmdbDateKey,
  isDefinitelyFutureAirDate,
  isPlayableEpisode,
  seasonHasPlayableEpisodes,
  seasonSummaryNeedsEpisodeVerification,
} from "@/services/catalog/tmdb-release";

const TODAY = "2026-06-08";

describe("isPlayableEpisode", () => {
  test("treats missing air date as playable", () => {
    expect(isPlayableEpisode("", TODAY)).toBe(true);
    expect(isPlayableEpisode("   ", TODAY)).toBe(true);
  });

  test("treats past full dates as playable", () => {
    expect(isPlayableEpisode("2026-06-01", TODAY)).toBe(true);
    expect(isPlayableEpisode("2025-12-31", TODAY)).toBe(true);
  });

  test("keeps today playable and hides only strictly future dates", () => {
    expect(isPlayableEpisode(TODAY, TODAY)).toBe(true);
    expect(isPlayableEpisode("2026-12-01", TODAY)).toBe(false);
  });

  test("treats year-only dates as playable when year is not after today", () => {
    expect(isPlayableEpisode("2025", TODAY)).toBe(true);
    expect(isPlayableEpisode("2026", TODAY)).toBe(true);
    expect(isPlayableEpisode("2027", TODAY)).toBe(false);
  });

  test("treats unparseable dates as playable", () => {
    expect(isPlayableEpisode("soon", TODAY)).toBe(true);
  });
});

describe("season playable helpers", () => {
  test("filters unreleased episodes from a mixed season", () => {
    const episodes = [
      { airDate: "2026-01-01", number: 1 },
      { airDate: "2026-12-01", number: 2 },
    ];
    expect(filterPlayableEpisodes(episodes, TODAY)).toEqual([{ airDate: "2026-01-01", number: 1 }]);
    expect(seasonHasPlayableEpisodes(episodes, TODAY)).toBe(true);
  });

  test("marks an entirely future season as not playable", () => {
    const episodes = [{ airDate: "2026-12-01", number: 1 }];
    expect(filterPlayableEpisodes(episodes, TODAY)).toEqual([]);
    expect(seasonHasPlayableEpisodes(episodes, TODAY)).toBe(false);
  });
});

describe("formatTmdbDateKey", () => {
  test("formats local calendar date", () => {
    expect(formatTmdbDateKey(new Date("2026-06-08T15:30:00"))).toBe("2026-06-08");
  });
});

describe("season summary fast path", () => {
  test("flags definitely-future season air dates", () => {
    expect(isDefinitelyFutureAirDate("2026-12-01", TODAY)).toBe(true);
    expect(isDefinitelyFutureAirDate("2026-01-01", TODAY)).toBe(false);
    expect(isDefinitelyFutureAirDate("", TODAY)).toBe(false);
  });

  test("requires episode verification only when season air date is missing", () => {
    expect(seasonSummaryNeedsEpisodeVerification("")).toBe(true);
    expect(seasonSummaryNeedsEpisodeVerification("2026-01-01")).toBe(false);
  });
});
