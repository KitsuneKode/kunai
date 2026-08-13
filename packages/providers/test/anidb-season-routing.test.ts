import { describe, expect, test } from "bun:test";

import type { AnidbEpisodeEntry } from "../src/anidb/client";
import { parseAnidbSeasonEvidence, type AnidbSearchResult } from "../src/anidb/direct";
import { routeAnidbSeason } from "../src/anidb/season-routing";

function result(id: string, title: string): AnidbSearchResult {
  const numericId = Number(id.match(/-(\d+)$/)?.[1]);
  return { id, title, numericId, seasonEvidence: parseAnidbSeasonEvidence(title) };
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
