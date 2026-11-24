import { describe, expect, test } from "bun:test";

import {
  buildWikidataTitleQuery,
  readSearchEntityIds,
  readSparqlRows,
  searchWikidataTmdbTitles,
  WikidataSearchUnavailableError,
  wikidataRowsToSearchResults,
  type WikidataFetch,
} from "@/services/catalog/wikidata-search";
import type { JsonObject, JsonValue } from "@kunai/types";

function uri(id: string): JsonObject {
  return { type: "uri", value: `http://www.wikidata.org/entity/${id}` };
}
function literal(value: string): JsonObject {
  return { type: "literal", value };
}

const SEARCH_PAYLOAD: JsonValue = {
  query: { search: [{ title: "Q114819" }, { title: "Q60834962" }, { title: "not-an-id" }] },
};

const SPARQL_PAYLOAD: JsonValue = {
  results: {
    bindings: [
      // Dune (1984): English label, fewer sitelinks.
      {
        item: uri("Q114819"),
        movie: literal("841"),
        en: literal("Dune"),
        date: literal("1984-12-14T00:00:00Z"),
        links: literal("60"),
        anime: literal("false"),
      },
      // Dune (2021): only a language-neutral `mul` label, more sitelinks.
      {
        item: uri("Q60834962"),
        movie: literal("438631"),
        mul: literal("Dune"),
        date: literal("2021-09-03T00:00:00Z"),
        links: literal("71"),
        anime: literal("false"),
      },
    ],
  },
};

function hostOf(url: string): string {
  return new URL(url).hostname;
}

describe("Wikidata movie/series search", () => {
  test("an HTTP 200 MediaWiki error envelope is an outage, not an empty search", async () => {
    const fetchImpl: WikidataFetch = async () =>
      new Response(JSON.stringify({ error: { code: "unknownerror", info: "request failed" } }), {
        status: 200,
      });
    await expect(searchWikidataTmdbTitles("dune", { fetchImpl })).rejects.toBeInstanceOf(
      WikidataSearchUnavailableError,
    );
  });

  test("the exact-title row wins for a TMDB id reached from two items", () => {
    const results = wikidataRowsToSearchResults("dune", [
      { item: "Q1", label: "Dune (franchise entry)", movie: "1", links: "10" },
      { item: "Q2", label: "Dunes Elsewhere", movie: "2", links: "50" },
      { item: "Q3", label: "Dune", movie: "1", links: "5" },
    ]);
    expect(results.map((entry) => `${entry.title}:${entry.id}`)).toEqual([
      "Dune:1",
      "Dunes Elsewhere:2",
    ]);
  });

  test("parses entity ids and SPARQL rows, keeping only well-formed ids", () => {
    expect(readSearchEntityIds(SEARCH_PAYLOAD)).toEqual(["Q114819", "Q60834962"]);
    expect(readSearchEntityIds({ error: "x" })).toEqual([]);
    const rows = readSparqlRows(SPARQL_PAYLOAD);
    expect(rows.map((row) => [row.item, row.label, row.movie])).toEqual([
      ["Q114819", "Dune", "841"],
      ["Q60834962", "Dune", "438631"],
    ]);
  });

  test("exact title matches rank by notability; items without a TMDB id are dropped", () => {
    const results = wikidataRowsToSearchResults("dune", [
      ...readSparqlRows(SPARQL_PAYLOAD),
      { item: "Q1", label: "Dune Novel", links: "300" },
      { item: "Q2", label: "Dunes of Mars", movie: "5", links: "500" },
    ]);
    expect(results.map((entry) => `${entry.title}:${entry.id}`)).toEqual([
      "Dune:438631",
      "Dune:841",
      "Dunes of Mars:5",
    ]);
    expect(results[0]).toMatchObject({
      type: "movie",
      year: "2021",
      metadataSource: "Wikidata",
      externalIds: { tmdbId: "438631" },
    });
  });

  test("an item with movie and TV ids yields both; anime is flagged; duplicates collapse", () => {
    const results = wikidataRowsToSearchResults("shogun", [
      { item: "Q1", label: "Shōgun", tv: "126308", movie: "999", links: "36", anime: "false" },
      { item: "Q2", label: "Shōgun", tv: "126308", links: "1" },
      { item: "Q3", label: "Spirited Away", movie: "129", anime: "true", links: "90" },
    ]);
    expect(results.map((entry) => `${entry.type}:${entry.id}`)).toEqual([
      "movie:999",
      "series:126308",
      "movie:129",
    ]);
    expect(results.find((entry) => entry.id === "129")?.isAnime).toBe(true);
  });

  test("the query asks for both TMDB properties and the mul label", () => {
    const query = buildWikidataTitleQuery(["Q1", "Q2"]);
    expect(query).toContain("VALUES ?item { wd:Q1 wd:Q2 }");
    expect(query).toContain("wdt:P4947");
    expect(query).toContain("wdt:P4983");
    expect(query).toContain('LANG(?mulLabel) = "mul"');
  });

  test("end to end: search, then one SPARQL query, with a descriptive User-Agent", async () => {
    const seen: { host: string; userAgent: string | null; method: string }[] = [];
    const fetchImpl: WikidataFetch = async (input, init) => {
      const headers = new Headers(init.headers);
      seen.push({
        host: hostOf(input),
        userAgent: headers.get("user-agent"),
        method: init.method ?? "GET",
      });
      const body = hostOf(input) === "query.wikidata.org" ? SPARQL_PAYLOAD : SEARCH_PAYLOAD;
      return new Response(JSON.stringify(body), { status: 200 });
    };

    const results = await searchWikidataTmdbTitles("Dune", { fetchImpl });
    expect(results.map((entry) => entry.id)).toEqual(["438631", "841"]);
    expect(seen.map((entry) => `${entry.method} ${entry.host}`)).toEqual([
      "GET www.wikidata.org",
      "POST query.wikidata.org",
    ]);
    expect(seen.every((entry) => entry.userAgent?.startsWith("Kunai"))).toBe(true);
  });

  test("no search hits resolves [] without a SPARQL request", async () => {
    let calls = 0;
    const fetchImpl: WikidataFetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 });
    };
    expect(await searchWikidataTmdbTitles("zzqqxx", { fetchImpl })).toEqual([]);
    expect(calls).toBe(1);
  });

  test("HTTP errors, transport failures and garbage reject as unavailable", async () => {
    const cases: WikidataFetch[] = [
      async () => new Response("busy", { status: 503 }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => new Response("<html>", { status: 200 }),
    ];
    for (const respond of cases) {
      await expect(searchWikidataTmdbTitles("dune", { fetchImpl: respond })).rejects.toBeInstanceOf(
        WikidataSearchUnavailableError,
      );
    }
  });

  test("a caller abort propagates as the abort, not as unavailable", async () => {
    const controller = new AbortController();
    const fetchImpl: WikidataFetch = async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    };
    const failure = await searchWikidataTmdbTitles("dune", {
      fetchImpl,
      signal: controller.signal,
    }).catch((error: Error) => error);
    expect(failure).not.toBeInstanceOf(WikidataSearchUnavailableError);
    expect(failure).toBeInstanceOf(DOMException);
  });
});
