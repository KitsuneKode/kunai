import { describe, expect, test } from "bun:test";

import type { TitleIdentity } from "@kunai/types";

import { resolveTmdbCatalogId } from "../src/shared/catalog-id";

const movie = (id: string, tmdbId?: string): TitleIdentity => ({
  id,
  kind: "movie",
  title: "Bloodhounds",
  ...(tmdbId === undefined ? {} : { tmdbId }),
});

const series = (id: string, tmdbId?: string): TitleIdentity => ({
  id,
  kind: "series",
  title: "Bloodhounds",
  ...(tmdbId === undefined ? {} : { tmdbId }),
});

describe("resolveTmdbCatalogId", () => {
  test("accepts an explicit tmdbId", () => {
    expect(resolveTmdbCatalogId(movie("whatever", "299167"))).toBe(299167);
  });

  /**
   * `kunai -i 438631 -t movie` and the live provider smokes both pass a bare
   * numeric title id with no `externalIds`, so a bare complete decimal is a
   * supported production identity — not something to fail closed on.
   */
  test("accepts a bare complete decimal title id", () => {
    expect(resolveTmdbCatalogId(movie("299167"))).toBe(299167);
    expect(resolveTmdbCatalogId(series("127529"))).toBe(127529);
  });

  test("accepts an exact tmdb: prefix", () => {
    expect(resolveTmdbCatalogId(movie("tmdb:299167"))).toBe(299167);
  });

  test("prefers the explicit tmdbId over the title id", () => {
    expect(resolveTmdbCatalogId(movie("111", "299167"))).toBe(299167);
  });

  test("rejects partially numeric ids instead of parsing a prefix out of them", () => {
    expect(resolveTmdbCatalogId(movie("299167abc"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("x", "299167abc"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("12 34"))).toBeNull();
  });

  test("rejects zero, negatives, signs, decimals and exponents", () => {
    expect(resolveTmdbCatalogId(movie("0"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("-5"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("+5"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("4.5"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("1e5"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("x", "0"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("x", "-5"))).toBeNull();
  });

  test("rejects padded ids without trimming them into shape", () => {
    expect(resolveTmdbCatalogId(movie(" 299167 "))).toBeNull();
    expect(resolveTmdbCatalogId(movie("tmdb: 299167"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("x", " 299167 "))).toBeNull();
    expect(resolveTmdbCatalogId(movie(""))).toBeNull();
    expect(resolveTmdbCatalogId(movie("   "))).toBeNull();
  });

  test("rejects other catalogs' and provider-native ids", () => {
    expect(resolveTmdbCatalogId(movie("anilist:299167"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("mal:21"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("bxCKTopaque"))).toBeNull();
    expect(resolveTmdbCatalogId(movie("one-piece-69"))).toBeNull();
  });

  test("rejects ids beyond safe integer range", () => {
    expect(resolveTmdbCatalogId(movie("9".repeat(25)))).toBeNull();
  });
});
