import { expect, test } from "bun:test";

import { shouldIncludeDiscoverItem } from "@/app/discover/discover-results";
import type { SearchResult } from "@/domain/types";

const item = (type: "movie" | "series", isAnime = false): SearchResult => ({
  id: "1",
  type,
  title: "T",
  year: "2026",
  overview: "",
  posterPath: null,
  isAnime,
});

// Neon features review #11: anime films vanished from anime-mode Discover.
test("anime mode keeps anime films in auto and anime-only discover", () => {
  expect(shouldIncludeDiscoverItem("auto", "anime", item("movie"))).toBe(true);
  expect(shouldIncludeDiscoverItem("anime-only", "anime", item("movie"))).toBe(true);
});

test("anime-only outside anime mode keeps series and anime-classified films only", () => {
  expect(shouldIncludeDiscoverItem("anime-only", "series", item("series"))).toBe(true);
  expect(shouldIncludeDiscoverItem("anime-only", "series", item("movie", true))).toBe(true);
  expect(shouldIncludeDiscoverItem("anime-only", "series", item("movie"))).toBe(false);
  expect(shouldIncludeDiscoverItem("auto", "youtube", item("series"))).toBe(false);
});
