import { describe, expect, test } from "bun:test";

import { matchProviderCatalogTitle, normalizeTitleKey } from "../src/shared/provider-title-match";

describe("normalizeTitleKey", () => {
  test("two catalogs' spellings of one title key the same", () => {
    expect(normalizeTitleKey("Frieren: Beyond Journey's End")).toBe(
      normalizeTitleKey("Frieren - Beyond Journeys End"),
    );
  });

  test("accents and case do not separate titles", () => {
    expect(normalizeTitleKey("Pokémon")).toBe(normalizeTitleKey("POKEMON"));
  });

  test("a trailing format note is not part of the name", () => {
    expect(normalizeTitleKey("Jujutsu Kaisen (TV)")).toBe(normalizeTitleKey("Jujutsu Kaisen"));
    expect(normalizeTitleKey("Your Name (Movie)")).toBe(normalizeTitleKey("Your Name"));
  });

  test("a year in parentheses still separates two shows", () => {
    expect(normalizeTitleKey("Hunter x Hunter (2011)")).not.toBe(
      normalizeTitleKey("Hunter x Hunter"),
    );
  });

  test("letters outside Latin survive", () => {
    expect(normalizeTitleKey("葬送のフリーレン")).toBe("葬送のフリーレン");
  });
});

describe("matchProviderCatalogTitle", () => {
  const rows = [
    {
      slug: "s1",
      title: "Sousou no Frieren",
      englishTitle: "Frieren: Beyond Journey's End",
      year: 2023,
    },
    { slug: "s2", title: "Sousou no Frieren 2nd Season", year: 2026 },
    { slug: "gg", title: "Death Note", altNames: ["DEATH NOTE", "デスノート"] },
  ];

  test("matches on any name either side lists", () => {
    expect(matchProviderCatalogTitle(rows, { title: "Frieren: Beyond Journey's End" })?.slug).toBe(
      "s1",
    );
    expect(matchProviderCatalogTitle(rows, { title: "デスノート" })?.slug).toBe("gg");
  });

  test("a year both sides know must agree", () => {
    expect(matchProviderCatalogTitle(rows, { title: "Sousou no Frieren", year: 2031 })).toBeNull();
    expect(matchProviderCatalogTitle(rows, { title: "Sousou no Frieren", year: 2023 })?.slug).toBe(
      "s1",
    );
  });

  test("a row without a year is not ruled out by one", () => {
    expect(matchProviderCatalogTitle(rows, { title: "Death Note", year: 2006 })?.slug).toBe("gg");
  });

  test("more than one candidate is no match", () => {
    const twins = [...rows, { slug: "gg2", title: "Death Note" }];
    expect(matchProviderCatalogTitle(twins, { title: "Death Note" })).toBeNull();
  });

  test("dropping a format note never merges two shows into a guess", () => {
    const both = [
      { slug: "tv", title: "Jujutsu Kaisen (TV)" },
      { slug: "movie", title: "Jujutsu Kaisen (Movie)" },
    ];
    expect(matchProviderCatalogTitle(both, { title: "Jujutsu Kaisen" })).toBeNull();
    expect(matchProviderCatalogTitle(both.slice(0, 1), { title: "Jujutsu Kaisen" })?.slug).toBe(
      "tv",
    );
  });

  test("an empty title matches nothing", () => {
    expect(matchProviderCatalogTitle(rows, { title: "  " })).toBeNull();
  });
});
