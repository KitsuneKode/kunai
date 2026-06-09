import { expect, test } from "bun:test";

import {
  resolveCatalogPosterUrl,
  resolveCatalogPosterUrlFromCandidates,
} from "@/domain/catalog/resolve-catalog-poster-url";

test("resolveCatalogPosterUrl expands TMDB relative paths", () => {
  expect(resolveCatalogPosterUrl("/abc.jpg")).toBe("https://image.tmdb.org/t/p/w500/abc.jpg");
  expect(resolveCatalogPosterUrl("/abc.jpg", { tmdbSize: "w342" })).toBe(
    "https://image.tmdb.org/t/p/w342/abc.jpg",
  );
});

test("resolveCatalogPosterUrl passes through absolute HTTPS URLs", () => {
  expect(
    resolveCatalogPosterUrl(
      "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21.jpg",
    ),
  ).toBe("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21.jpg");
});

test("resolveCatalogPosterUrl rejects non-https and local paths", () => {
  expect(resolveCatalogPosterUrl("http://example.com/poster.jpg")).toBeNull();
  expect(resolveCatalogPosterUrl("file:///tmp/poster.jpg")).toBeNull();
  expect(resolveCatalogPosterUrl("")).toBeNull();
});

test("resolveCatalogPosterUrlFromCandidates picks the first valid candidate", () => {
  expect(
    resolveCatalogPosterUrlFromCandidates([undefined, "/poster.jpg", "https://cdn.example/x.jpg"]),
  ).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
});
