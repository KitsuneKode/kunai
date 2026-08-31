import { describe, expect, test } from "bun:test";

import { sameEpisodeNumbering } from "@/domain/media/episode-numbering";

/**
 * The contract for the one rule shared by the offline keep set, the offline
 * delete set, the protected-episode check, and queue restore. Those four
 * disagreeing is what made "keep the last 3 watched" delete all three, so the
 * rule is pinned here rather than only through each caller.
 */
describe("sameEpisodeNumbering", () => {
  describe("absolute numbering on both sides", () => {
    test("equal absolute episodes match", () => {
      expect(sameEpisodeNumbering({ absoluteEpisode: 13 }, { absoluteEpisode: 13 })).toBe(true);
    });

    test("different absolute episodes do not match", () => {
      expect(sameEpisodeNumbering({ absoluteEpisode: 13 }, { absoluteEpisode: 14 })).toBe(false);
    });

    test("absolute wins over a disagreeing season", () => {
      expect(
        sameEpisodeNumbering(
          { season: 1, absoluteEpisode: 13 },
          { season: 2, absoluteEpisode: 13 },
        ),
      ).toBe(true);
    });
  });

  describe("absolute on one side only", () => {
    test("an absolute episode matches its season-relative twin", () => {
      // The regression: returning early whenever *either* side carried an
      // absolute number compared `13 === undefined`, so a history row written by
      // an absolute-numbered source never matched its own queue entry and the
      // resume head was not promoted after a crash.
      expect(sameEpisodeNumbering({ absoluteEpisode: 13 }, { season: 1, episode: 13 })).toBe(true);
    });

    test("a different episode number still does not match", () => {
      expect(sameEpisodeNumbering({ absoluteEpisode: 13 }, { season: 1, episode: 12 })).toBe(false);
    });

    test("a season beyond the first is not assumed to map onto an absolute number", () => {
      // Absolute 13 may or may not be S02E01; nothing here knows the season
      // boundaries, so the conservative answer is "not the same episode".
      expect(sameEpisodeNumbering({ absoluteEpisode: 13 }, { season: 2, episode: 1 })).toBe(false);
    });
  });

  describe("season-relative numbering", () => {
    test("the same season and episode match", () => {
      expect(sameEpisodeNumbering({ season: 2, episode: 5 }, { season: 2, episode: 5 })).toBe(true);
    });

    test("a different season does not match", () => {
      expect(sameEpisodeNumbering({ season: 1, episode: 5 }, { season: 2, episode: 5 })).toBe(
        false,
      );
    });

    test("a missing season means season 1 on both sides", () => {
      // The regression: normalizing only one side compared `1 === undefined`, so
      // an absolute-numbered anime job (which carries no season) matched nothing
      // and "keep the last 3 watched" retained zero of them.
      expect(sameEpisodeNumbering({ episode: 5 }, { season: 1, episode: 5 })).toBe(true);
      expect(sameEpisodeNumbering({ season: 1, episode: 5 }, { episode: 5 })).toBe(true);
    });

    test("a missing episode on both sides means episode 1", () => {
      expect(sameEpisodeNumbering({}, {})).toBe(true);
      expect(sameEpisodeNumbering({}, { season: 1, episode: 1 })).toBe(true);
    });
  });

  test("the rule is symmetric", () => {
    const cases: readonly [Record<string, number>, Record<string, number>][] = [
      [{ absoluteEpisode: 13 }, { season: 1, episode: 13 }],
      [{ absoluteEpisode: 13 }, { season: 2, episode: 1 }],
      [{ episode: 5 }, { season: 1, episode: 5 }],
      [
        { season: 2, episode: 5 },
        { season: 2, episode: 5 },
      ],
      [
        { season: 1, episode: 5 },
        { season: 2, episode: 5 },
      ],
      [{ absoluteEpisode: 13 }, { absoluteEpisode: 14 }],
      [{}, { season: 1, episode: 1 }],
    ];

    for (const [left, right] of cases) {
      expect(sameEpisodeNumbering(left, right)).toBe(sameEpisodeNumbering(right, left));
    }
  });
});
