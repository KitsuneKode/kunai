import { expect, test } from "bun:test";

import { parseArmIdsPayload } from "@/services/catalog/arm-client";

test("parseArmIdsPayload reads the full Death Note bag from an ids object", () => {
  const graph = parseArmIdsPayload({
    anilist: 1535,
    myanimelist: 1535,
    themoviedb: 13916,
    imdb: "tt0877057",
    "themoviedb-season": 1,
  });

  expect(graph).toEqual({
    anilistId: "1535",
    malId: "1535",
    tmdbId: "13916",
    imdbId: "tt0877057",
    tmdbSeason: 1,
  });
});

test("parseArmIdsPayload takes the first row of a themoviedb array response", () => {
  const graph = parseArmIdsPayload([
    { anilist: 1535, myanimelist: 1535, themoviedb: 13916 },
    { anilist: 30013, myanimelist: 2994, themoviedb: 13916 },
  ]);

  expect(graph?.anilistId).toBe("1535");
  expect(graph?.tmdbId).toBe("13916");
});

test("parseArmIdsPayload returns null for empty or unusable payloads", () => {
  expect(parseArmIdsPayload(null)).toBeNull();
  expect(parseArmIdsPayload([])).toBeNull();
  expect(parseArmIdsPayload({})).toBeNull();
  expect(parseArmIdsPayload({ anilist: "not-a-number" })).toBeNull();
});

test("parseArmIdsPayload ignores malformed fields but keeps valid ones", () => {
  const graph = parseArmIdsPayload({
    anilist: 20431,
    imdb: 42,
    "themoviedb-season": "one",
  });

  expect(graph).toEqual({ anilistId: "20431" });
});
