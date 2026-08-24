import { describe, expect, test } from "bun:test";

import { applyCatalogDetailToTitle } from "@/domain/catalog/apply-title-detail";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { TitleInfo } from "@/domain/types";

const dune: TitleDetail = {
  id: "438631",
  type: "movie",
  title: "Dune",
  year: "2021",
  artwork: { poster: "/duneposter.jpg" },
  externalIds: { tmdbId: "438631", imdbId: "tt1160419" },
};

/** What `-i 438631 -t movie` hands the session before the catalog answers. */
const placeholder: TitleInfo = {
  id: "438631",
  type: "movie",
  name: "TMDB 438631",
};

describe("applyCatalogDetailToTitle", () => {
  test("adopts the catalog name over the -i placeholder", () => {
    expect(applyCatalogDetailToTitle(placeholder, dune).name).toBe("Dune");
  });

  test("adopts the catalog name over the share `ns:id` fallback", () => {
    // `--open` on a ref with no title names the title after its own id.
    const shareFallback: TitleInfo = { id: "tmdb:438631", type: "movie", name: "tmdb:438631" };
    const detail: TitleDetail = { ...dune, id: "tmdb:438631" };
    expect(applyCatalogDetailToTitle(shareFallback, detail).name).toBe("Dune");
  });

  test("never overwrites a name the user actually searched for", () => {
    const searched: TitleInfo = { ...placeholder, name: "Dune: Part One" };
    expect(applyCatalogDetailToTitle(searched, dune).name).toBe("Dune: Part One");
  });

  test("keeps the placeholder when the catalog answers with nothing usable", () => {
    const blank: TitleDetail = { id: "438631", type: "movie", title: "   " };
    expect(applyCatalogDetailToTitle(placeholder, blank).name).toBe("TMDB 438631");
  });

  test("fills the poster from catalog artwork, normalised to an absolute URL", () => {
    expect(applyCatalogDetailToTitle(placeholder, dune).posterUrl).toBe(
      "https://image.tmdb.org/t/p/w500/duneposter.jpg",
    );
  });

  test("keeps a poster the title already carries", () => {
    const withPoster: TitleInfo = { ...placeholder, posterUrl: "https://cdn.example/own.jpg" };
    expect(applyCatalogDetailToTitle(withPoster, dune).posterUrl).toBe(
      "https://cdn.example/own.jpg",
    );
  });

  test("fills external ids, and the title's own ids win on conflict", () => {
    const withIds: TitleInfo = { ...placeholder, externalIds: { tmdbId: "999" } };
    expect(applyCatalogDetailToTitle(withIds, dune).externalIds).toEqual({
      tmdbId: "999",
      imdbId: "tt1160419",
    });
  });

  test("fills year and episode count only when the title lacks them", () => {
    const series: TitleInfo = { id: "1396", type: "series", name: "TMDB 1396" };
    const detail: TitleDetail = {
      id: "1396",
      type: "series",
      title: "Breaking Bad",
      year: "2008",
      episodeCount: 62,
    };
    const applied = applyCatalogDetailToTitle(series, detail);
    expect(applied.year).toBe("2008");
    expect(applied.episodeCount).toBe(62);

    const known: TitleInfo = { ...series, year: "2009", episodeCount: 5 };
    const keptApplied = applyCatalogDetailToTitle(known, detail);
    expect(keptApplied.year).toBe("2009");
    expect(keptApplied.episodeCount).toBe(5);
  });

  test("still upgrades a mistyped series to a film, dropping its episode count", () => {
    const mistyped: TitleInfo = { ...placeholder, type: "series", episodeCount: 1 };
    const applied = applyCatalogDetailToTitle(mistyped, dune);
    expect(applied.type).toBe("movie");
    expect(applied.episodeCount).toBeUndefined();
  });

  test("never downgrades a film back to a series from a later fetch", () => {
    const film: TitleInfo = { ...placeholder, type: "movie" };
    const seriesDetail: TitleDetail = {
      id: "438631",
      type: "series",
      title: "Dune",
      seasonCount: 2,
    };
    expect(applyCatalogDetailToTitle(film, seriesDetail).type).toBe("movie");
  });

  test("ignores a detail for a different title", () => {
    const other: TitleDetail = { ...dune, id: "999", title: "Something Else" };
    expect(applyCatalogDetailToTitle(placeholder, other)).toBe(placeholder);
  });

  test("returns the same object when there is nothing to adopt", () => {
    const complete: TitleInfo = {
      id: "438631",
      type: "movie",
      name: "Dune",
      year: "2021",
      posterUrl: "https://cdn.example/own.jpg",
      externalIds: { tmdbId: "438631", imdbId: "tt1160419" },
    };
    expect(applyCatalogDetailToTitle(complete, dune)).toBe(complete);
  });
});
