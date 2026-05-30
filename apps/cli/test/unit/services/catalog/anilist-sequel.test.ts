import { expect, test } from "bun:test";

import { extractAniListSequelSignal } from "@/services/catalog/CatalogScheduleService";

test("a RELEASING sequel cour surfaces with latest-aired = nextAiring - 1", () => {
  const signal = extractAniListSequelSignal([
    {
      relationType: "SEQUEL",
      node: { id: 222, type: "ANIME", status: "RELEASING", nextAiringEpisode: { episode: 4 } },
    },
  ]);
  expect(signal).toEqual({ mediaId: 222, latestAiredEpisode: 3, nextAiringEpisode: 4 });
});

test("a FINISHED sequel surfaces with latest-aired = episodes", () => {
  const signal = extractAniListSequelSignal([
    { relationType: "SEQUEL", node: { id: 9, type: "ANIME", status: "FINISHED", episodes: 12 } },
  ]);
  expect(signal).toEqual({ mediaId: 9, latestAiredEpisode: 12, nextAiringEpisode: undefined });
});

test("no SEQUEL edge yields no signal", () => {
  expect(
    extractAniListSequelSignal([
      { relationType: "PREQUEL", node: { id: 1, type: "ANIME", status: "FINISHED", episodes: 12 } },
      { relationType: "SIDE_STORY", node: { id: 2, type: "ANIME", status: "RELEASING" } },
    ]),
  ).toBeUndefined();
});

test("a non-anime SEQUEL (e.g. manga) is ignored", () => {
  expect(
    extractAniListSequelSignal([
      { relationType: "SEQUEL", node: { id: 3, type: "MANGA", status: "RELEASING" } },
    ]),
  ).toBeUndefined();
});

test("an announced-but-not-concrete sequel (no airing, no episodes) is ignored", () => {
  expect(
    extractAniListSequelSignal([
      { relationType: "SEQUEL", node: { id: 4, type: "ANIME", status: "NOT_YET_RELEASED" } },
    ]),
  ).toBeUndefined();
});

test("the first qualifying SEQUEL wins", () => {
  const signal = extractAniListSequelSignal([
    {
      relationType: "SEQUEL",
      node: { id: 10, type: "ANIME", status: "RELEASING", nextAiringEpisode: { episode: 2 } },
    },
    { relationType: "SEQUEL", node: { id: 11, type: "ANIME", status: "FINISHED", episodes: 24 } },
  ]);
  expect(signal?.mediaId).toBe(10);
});

test("null or empty edges yield no signal", () => {
  expect(extractAniListSequelSignal(null)).toBeUndefined();
  expect(extractAniListSequelSignal(undefined)).toBeUndefined();
  expect(extractAniListSequelSignal([])).toBeUndefined();
});
