import { describe, expect, test } from "bun:test";

import type { AnidbEpisodeEntry } from "../src/anidb/client";
import { parseAnidbSeasonEvidence, type AnidbSearchResult } from "../src/anidb/direct";
import { routeAnidbSeason } from "../src/anidb/season-routing";

function result(id: string, title: string, kind?: "movie"): AnidbSearchResult {
  const numericId = Number(id.match(/-(\d+)$/)?.[1]);
  return {
    id,
    title,
    numericId,
    ...(kind ? { kind } : {}),
    seasonEvidence: parseAnidbSeasonEvidence(title),
  };
}

const noEpisodes = async (): Promise<readonly AnidbEpisodeEntry[]> => [];

describe("routeAnidbSeason", () => {
  test("uses an absolute episode only after the routed base catalog confirms it", async () => {
    const episodeLookups: string[] = [];
    const route = await routeAnidbSeason({
      base: result("catalog-confirmed-show-690", "Catalog Confirmed Show"),
      episode: { season: 1, episode: 27, absoluteEpisode: 1085 },
      search: async () => {
        throw new Error("season one must not search for a sibling");
      },
      episodes: async (showId) => {
        episodeLookups.push(showId);
        return [{ id: 501085, number: 1085 }];
      },
    });

    expect(episodeLookups).toEqual(["catalog-confirmed-show-690"]);
    expect(route).toEqual({
      requestedSeason: 1,
      baseShowId: "catalog-confirmed-show-690",
      routedShowId: "catalog-confirmed-show-690",
      episodeNumber: 1085,
      usedAbsoluteEpisode: true,
      numberingEvidence: {
        kind: "absolute-episode-catalog",
        routedShowId: "catalog-confirmed-show-690",
        requestedAbsoluteEpisode: 1085,
        matchedEpisodeId: 501085,
      },
      evidence: { kind: "base-season", normalizedBaseTitle: "catalog confirmed show" },
    });
  });

  test("a title without a season label uses cour numbering when its catalog does not confirm absolute numbering", async () => {
    const route = await routeAnidbSeason({
      base: result("plain-show-700", "Plain Show"),
      episode: { season: 1, episode: 1, absoluteEpisode: 13 },
      search: async () => {
        throw new Error("season one must not search for a sibling");
      },
      episodes: async () => [
        { id: 70001, number: 1 },
        { id: 70002, number: 2 },
      ],
    });

    expect(route).toMatchObject({
      episodeNumber: 1,
      usedAbsoluteEpisode: false,
      numberingEvidence: {
        kind: "cour",
        reason: "absolute-episode-not-in-routed-catalog",
        requestedAbsoluteEpisode: 13,
      },
    });
  });

  test("a catalog entry already labelled season two uses cour numbering without treating the title as an absolute base", async () => {
    const route = await routeAnidbSeason({
      base: result("solo-leveling-season-2-19837", "Solo Leveling Season 2"),
      episode: { season: 1, episode: 1, absoluteEpisode: 13 },
      search: async () => [],
      episodes: async () => {
        throw new Error("season-specific titles must not probe absolute numbering");
      },
    });

    expect(route?.routedShowId).toBe("solo-leveling-season-2-19837");
    expect(route?.episodeNumber).toBe(1);
    expect(route?.usedAbsoluteEpisode).toBe(false);
    expect(route?.numberingEvidence).toEqual({
      kind: "cour",
      reason: "routed-title-is-season-specific",
      requestedAbsoluteEpisode: 13,
    });
  });

  test("routes season two to the unique normalized sibling and uses cour episode", async () => {
    const queries: string[] = [];
    const route = await routeAnidbSeason({
      base: result("solo-leveling-19413", "Solo Leveling"),
      episode: { season: 2, episode: 1, absoluteEpisode: 13 },
      search: async (query) => {
        queries.push(query);
        return [
          result("solo-leveling-19413", "Solo Leveling"),
          result("solo-leveling-season-2-19837", "Solo Leveling Season 2"),
          result("solo-leveling-chibi-season-2-29999", "Solo Leveling Chibi Season 2"),
        ];
      },
      episodes: async () => {
        throw new Error("routed season siblings must use cour numbering without absolute lookup");
      },
    });

    expect(queries).toEqual(["solo leveling Season 2"]);
    expect(route).toEqual({
      requestedSeason: 2,
      baseShowId: "solo-leveling-19413",
      routedShowId: "solo-leveling-season-2-19837",
      episodeNumber: 1,
      usedAbsoluteEpisode: false,
      numberingEvidence: {
        kind: "cour",
        reason: "routed-season-sibling",
        requestedAbsoluteEpisode: 13,
      },
      evidence: {
        kind: "season-search",
        query: "solo leveling Season 2",
        matchedTitle: "Solo Leveling Season 2",
        matchedSeason: 2,
        titleMatch: "exact",
      },
    });
  });

  test("returns null when equally ranked season siblings are ambiguous", async () => {
    const route = await routeAnidbSeason({
      base: result("demo-1", "Demo"),
      episode: { season: 2, episode: 1 },
      search: async () => [
        result("demo-season-2-2", "Demo Season 2"),
        result("demo-second-season-3", "Demo 2nd Season"),
      ],
      episodes: noEpisodes,
    });
    expect(route).toBeNull();
  });

  test("returns null when no candidate carries the requested season evidence", async () => {
    const route = await routeAnidbSeason({
      base: result("demo-1", "Demo"),
      episode: { season: 3, episode: 2, absoluteEpisode: 26 },
      search: async () => [result("demo-special-9", "Demo Special")],
      episodes: noEpisodes,
    });
    expect(route).toBeNull();
  });
});

/**
 * AniDB names a show's last run "Final Season" instead of "Season N", so the
 * strict `seasonNumber === requestedSeason` filter dropped every candidate and
 * Attack on Titan season 4 could not be routed at all.
 *
 * The ordinal is not guessed from the words: it is derived from the sibling set
 * the search already returned. Titles here are the real ones AniDB serves.
 */
describe("final-season routing", () => {
  /**
   * The exact 15 rows `searchAnidb("attack on titan")` returns. Copied from a
   * live response on purpose: an earlier fixture listed a single "Final Season"
   * row, which let a rule that could not survive real data pass its tests. The
   * real set splits that run across three siblings, and the films, OVAs and
   * spin-offs around them are what the routing has to refuse.
   */
  const aotSiblings = [
    result("attack-on-titan-457", "Attack on Titan"),
    result("attack-on-titan-the-last-attack-470", "Attack on Titan: The Last Attack"),
    result("attack-on-titan-final-season-464", "Attack on Titan: Final Season"),
    result("attack-on-titan-final-season-part-2-466", "Attack on Titan: Final Season Part 2"),
    result(
      "attack-on-titan-final-season-the-final-chapters-465",
      "Attack on Titan: Final Season - The Final Chapters",
    ),
    result("attack-on-titan-oad-458", "Attack on Titan OAD"),
    result("attack-on-titan-junior-high-467", "Attack on Titan: Junior High"),
    result("attack-on-titan-chronicle-462", "Attack on Titan: Chronicle"),
    result("attack-on-titan-season-2-459", "Attack on Titan Season 2"),
    result("attack-on-titan-season-3-460", "Attack on Titan Season 3"),
    result("attack-on-titan-season-3-part-2-461", "Attack on Titan Season 3 Part 2"),
    result("attack-on-titan-no-regrets-469", "Attack on Titan: No Regrets"),
    result("attack-on-titan-lost-girls-468", "Attack on Titan: Lost Girls"),
    result("attack-on-titan-crimson-bow-and-arrow-463", "Attack on Titan: Crimson Bow and Arrow"),
    result("attack-on-titan-wings-of-freedom-471", "Attack on Titan: Wings of Freedom"),
  ];

  test("routes a final season to the ordinal after the highest numbered sibling", async () => {
    const route = await routeAnidbSeason({
      base: result("attack-on-titan-457", "Attack on Titan"),
      episode: { season: 4, episode: 1 },
      search: async () => aotSiblings,
      episodes: noEpisodes,
    });

    expect(route?.routedShowId).toBe("attack-on-titan-final-season-464");
    expect(route?.requestedSeason).toBe(4);
    expect(route?.episodeNumber).toBe(1);
  });

  test("still routes explicitly numbered seasons ahead of the final season", async () => {
    const route = await routeAnidbSeason({
      base: result("attack-on-titan-457", "Attack on Titan"),
      episode: { season: 3, episode: 2 },
      search: async () => aotSiblings,
      episodes: noEpisodes,
    });

    expect(route?.routedShowId).toBe("attack-on-titan-season-3-460");
  });

  /**
   * Demon Slayer names every sequel after a story arc and carries no numbered
   * sibling at all. There is no evidence for which arc is "season 2" — AniDB,
   * AniList, and TMDB disagree — so this must keep failing closed rather than
   * route the user to the wrong show.
   */
  test("refuses to guess a season when siblings are arc-named", async () => {
    const demonSlayer = [
      result("demon-slayer-kimetsu-no-yaiba-1217", "Demon Slayer: Kimetsu no Yaiba"),
      result(
        "demon-slayer-kimetsu-no-yaiba-entertainment-district-arc-1222",
        "Demon Slayer: Kimetsu no Yaiba Entertainment District Arc",
      ),
      result(
        "demon-slayer-kimetsu-no-yaiba-mugen-train-arc-1219",
        "Demon Slayer: Kimetsu no Yaiba Mugen Train Arc",
      ),
    ];

    const route = await routeAnidbSeason({
      base: result("demon-slayer-kimetsu-no-yaiba-1217", "Demon Slayer: Kimetsu no Yaiba"),
      episode: { season: 2, episode: 1 },
      search: async () => demonSlayer,
      episodes: noEpisodes,
    });

    expect(route).toBeNull();
  });

  test("refuses a final season that does not sit at the requested ordinal", async () => {
    const route = await routeAnidbSeason({
      base: result("attack-on-titan-457", "Attack on Titan"),
      episode: { season: 6, episode: 1 },
      search: async () => aotSiblings,
      episodes: noEpisodes,
    });

    expect(route).toBeNull();
  });

  test("refuses when more than one unnumbered final-season sibling exists", async () => {
    const ambiguous = [
      result("show-1", "Show"),
      result("show-season-2-2", "Show Season 2"),
      result("show-final-season-3", "Show: Final Season"),
      result("show-the-final-season-4", "Show: The Final Season"),
    ];

    const route = await routeAnidbSeason({
      base: result("show-1", "Show"),
      episode: { season: 3, episode: 1 },
      search: async () => ambiguous,
      episodes: noEpisodes,
    });

    expect(route).toBeNull();
  });

  test("never treats a movie named Final Season as the requested season", async () => {
    const route = await routeAnidbSeason({
      base: result("show-1", "Show"),
      episode: { season: 4, episode: 1 },
      search: async () => [
        result("show-1", "Show"),
        result("show-season-2-2", "Show Season 2"),
        result("show-season-3-3", "Show Season 3"),
        result("show-final-season-4", "Show: Final Season", "movie"),
      ],
      episodes: noEpisodes,
    });

    expect(route).toBeNull();
  });

  test("does not let a spin-off season inflate the final-season ordinal", async () => {
    const route = await routeAnidbSeason({
      base: result("show-1", "Show"),
      episode: { season: 4, episode: 1 },
      search: async () => [
        result("show-1", "Show"),
        result("show-season-2-2", "Show Season 2"),
        result("show-season-3-3", "Show Season 3"),
        result("show-final-season-4", "Show: Final Season"),
        result("show-junior-high-season-9-9", "Show Junior High Season 9"),
      ],
      episodes: noEpisodes,
    });

    expect(route?.routedShowId).toBe("show-final-season-4");
  });

  /**
   * The sub-parts of a final season are not the season. All three of Attack on
   * Titan's final-run siblings say "final season"; treating them as equals made
   * the set ambiguous and refused a request that has one correct answer.
   */
  test("picks the final season itself over its parts and chapters", async () => {
    const queries: string[] = [];
    const route = await routeAnidbSeason({
      base: result("attack-on-titan-457", "Attack on Titan"),
      episode: { season: 4, episode: 3 },
      search: async (query) => {
        queries.push(query);
        return aotSiblings;
      },
      episodes: noEpisodes,
    });

    expect(route?.routedShowId).toBe("attack-on-titan-final-season-464");
    expect(route?.episodeNumber).toBe(3);
    // The numbered siblings carry the ordinal, and a `Season N` query does not
    // return them, so the base title must be asked for directly.
    expect(queries).toContain("attack on titan");
  });

  test("never routes a season request to a film, OVA, or spin-off", async () => {
    for (const season of [5, 7]) {
      const route = await routeAnidbSeason({
        base: result("attack-on-titan-457", "Attack on Titan"),
        episode: { season, episode: 1 },
        search: async () => aotSiblings,
        episodes: noEpisodes,
      });
      expect(route).toBeNull();
    }
  });
});
