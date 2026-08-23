import { expect, test } from "bun:test";

import {
  buildRandomResultBundle,
  buildRandomResultTray,
  buildStratifiedRandomPool,
  pickSurpriseCandidate,
} from "@/app/discover/random-results";
import type { SearchResult } from "@/domain/types";

const results: SearchResult[] = Array.from({ length: 6 }, (_, index) => ({
  id: String(index + 1),
  type: "series",
  title: `Pick ${index + 1}`,
  year: "2026",
  overview: "",
  posterPath: null,
  metadataSource: index % 2 === 0 ? "TMDB trending" : "History affinity",
}));

test("buildRandomResultTray returns a rerollable explained tray without mutating inputs", () => {
  const tray = buildRandomResultTray(results, {
    count: 3,
    random: () => 0,
  });

  expect(tray).toHaveLength(3);
  // The stratified head is preserved, not reshuffled. This previously asserted
  // ["Pick 2", "Pick 3", "Pick 4"] -- a pure artefact of shuffling the whole
  // pool, which discarded the 2/2/2 quota buildStratifiedRandomPool exists to
  // produce.
  expect(tray.map((result) => result.title)).toEqual(["Pick 1", "Pick 2", "Pick 3"]);
  expect(tray.every((result) => result.metadataSource?.startsWith("Random pick · "))).toBe(true);
  expect(results[0]?.metadataSource).toBe("TMDB trending");
});

test("buildRandomResultBundle describes random tray rerolls", () => {
  const bundle = buildRandomResultBundle(results, {
    count: 2,
    random: () => 0,
  });

  expect(bundle.subtitle).toBe("2 random picks · /random to reshuffle · /surprise for one pick");
  expect(bundle.results).toHaveLength(2);
});

test("buildStratifiedRandomPool blends surprise, trending, and discover without duplicates", () => {
  const trending: SearchResult[] = [
    {
      id: "t1",
      type: "movie",
      title: "Trending One",
      year: "2024",
      overview: "",
      posterPath: "/t1",
    },
  ];
  const discover: SearchResult[] = [
    {
      id: "d1",
      type: "series",
      title: "Discover One",
      year: "2023",
      overview: "",
      posterPath: "/d1",
    },
  ];
  const surprise: SearchResult[] = [
    {
      id: "s1",
      type: "movie",
      title: "Surprise One",
      year: "1998",
      overview: "",
      posterPath: "/s1",
    },
    {
      id: "s2",
      type: "series",
      title: "Surprise Two",
      year: "1999",
      overview: "",
      posterPath: "/s2",
    },
  ];

  const pool = buildStratifiedRandomPool(trending, discover, surprise, () => 0);
  const keys = new Set(pool.map((result) => `${result.type}:${result.id}`));

  expect(keys.has("movie:s1")).toBe(true);
  expect(keys.has("movie:t1")).toBe(true);
  expect(keys.has("series:d1")).toBe(true);
  expect(keys.size).toBe(pool.length);
});

test("pickSurpriseCandidate prefers poster-backed picks", () => {
  const pool: SearchResult[] = [
    { id: "1", type: "movie", title: "No art", year: "2020", overview: "", posterPath: null },
    {
      id: "2",
      type: "movie",
      title: "Poster pick",
      year: "2021",
      overview: "",
      posterPath: "/poster",
    },
  ];

  expect(pickSurpriseCandidate(pool, () => 0)?.title).toBe("Poster pick");
});

test("a configured tray size is honoured instead of the old hard five-item clamp", () => {
  const pool: SearchResult[] = Array.from({ length: 20 }, (_, index) => ({
    id: String(index + 1),
    type: "series",
    title: `Pick ${index + 1}`,
    year: "2026",
    overview: "",
    posterPath: null,
    metadataSource: "TMDB trending",
  }));

  // Settings offers 12/24/36/48/80. Every one of those exceeded the old clamp,
  // so no configured value could ever take effect.
  expect(buildRandomResultTray(pool, { count: 12, random: () => 0 })).toHaveLength(12);
  expect(buildRandomResultTray(pool, { count: 1, random: () => 0 })).toHaveLength(1);
});

test("the stratified quota block survives into the tray", () => {
  const surprise: SearchResult[] = ["s1", "s2"].map((id) => ({
    id,
    type: "series",
    title: id,
    year: "2026",
    overview: "",
    posterPath: null,
    metadataSource: "surprise",
  }));
  const trending: SearchResult[] = ["t1", "t2"].map((id) => ({
    id,
    type: "series",
    title: id,
    year: "2026",
    overview: "",
    posterPath: null,
    metadataSource: "trending",
  }));
  const discover: SearchResult[] = ["d1", "d2"].map((id) => ({
    id,
    type: "series",
    title: id,
    year: "2026",
    overview: "",
    posterPath: null,
    metadataSource: "discover",
  }));

  const pool = buildStratifiedRandomPool(trending, discover, surprise, () => 0);
  const tray = buildRandomResultTray(pool, { count: 6, random: () => 0 });

  // All three lanes must be represented; a uniform shuffle could drop one
  // entirely when a single pool is much larger than the others.
  const lanes = new Set(tray.map((r) => r.title[0]));
  expect(lanes).toEqual(new Set(["s", "t", "d"]));
});
