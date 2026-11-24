// Wikidata as the movie/series search fallback when every TMDB route fails.
//
// Wikidata is CC0, keyless, and independent of TMDB's hosts, and it records
// TMDB's own ids (P4947 movie, P4983 TV series). A result here carries the
// exact TMDB id, so picking it plays, downloads and records history against
// the same title a TMDB search would have returned. Items without a TMDB id
// are never returned: no id beats a wrong id.
//
// Two requests: a full-text search restricted to items that have a TMDB id,
// then one SPARQL query for the ids, label, date, anime flag and sitelink
// count (the popularity proxy used for ranking).

import type { SearchResult } from "@/domain/types";
import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import { isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
/** Wikimedia asks automated clients for a descriptive User-Agent. */
const WIKIDATA_USER_AGENT = "Kunai (+https://github.com/KitsuneKode/kunai)";
const SEARCH_TIMEOUT_MS = 3_000;
const SPARQL_TIMEOUT_MS = 4_000;
const SEARCH_LIMIT = 20;
const MAX_RESULTS = 12;
const ENTITY_ID = /^Q\d+$/;
const TMDB_ID = /^\d+$/;

/** Wikidata classes that mark a title as anime (routes it to anime providers). */
const ANIME_CLASSES = [
  "Q63952888", // anime television series
  "Q20650540", // anime film
  "Q1107", // anime (genre)
] as const;

export class WikidataSearchUnavailableError extends Error {
  constructor(reason: string, options?: { readonly cause?: unknown }) {
    super(`Wikidata search is unavailable: ${reason}`, options);
    this.name = "WikidataSearchUnavailableError";
  }
}

/** The slice of `fetch` this module uses (a test seam). */
export type WikidataFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface WikidataSearchOptions {
  readonly signal?: AbortSignal;
  readonly fetchImpl?: WikidataFetch;
}

/** One SPARQL binding row, flattened to `{ variable: value }`. */
export interface WikidataTitleRow {
  readonly item: string;
  readonly label?: string;
  readonly movie?: string;
  readonly tv?: string;
  readonly date?: string;
  readonly anime?: string;
  readonly links?: string;
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  options: WikidataSearchOptions,
  step: string,
): Promise<JsonValue> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: withTimeoutSignal(options.signal, timeoutMs),
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new WikidataSearchUnavailableError(`${step} request failed`, { cause });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new WikidataSearchUnavailableError(`${step} HTTP ${response.status}`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new WikidataSearchUnavailableError(`${step} response cut off`, { cause });
  }
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new WikidataSearchUnavailableError(`${step} unreadable`, { cause });
  }
  // MediaWiki reports API failures as HTTP 200 with a top-level `error`; read
  // as an empty search it would pass for an honest "no match".
  if (isJsonObject(parsed) && parsed.error !== undefined) {
    throw new WikidataSearchUnavailableError(`${step} API error`);
  }
  return parsed;
}

/** Entity ids from a `list=search` response, in Wikidata's relevance order. */
export function readSearchEntityIds(payload: JsonValue): string[] {
  if (!isJsonObject(payload) || !isJsonObject(payload.query)) return [];
  const hits = payload.query.search;
  if (!Array.isArray(hits)) return [];
  const ids: string[] = [];
  for (const hit of hits) {
    if (isJsonObject(hit) && isJsonString(hit.title) && ENTITY_ID.test(hit.title)) {
      ids.push(hit.title);
    }
  }
  return ids;
}

/** SPARQL JSON bindings flattened; entity URIs reduced to their trailing id. */
export function readSparqlRows(payload: JsonValue): WikidataTitleRow[] {
  if (!isJsonObject(payload) || !isJsonObject(payload.results)) return [];
  const bindings = payload.results.bindings;
  if (!Array.isArray(bindings)) return [];
  const rows: WikidataTitleRow[] = [];
  for (const binding of bindings) {
    if (!isJsonObject(binding)) continue;
    const read = (name: string): string | undefined => {
      const cell = binding[name];
      if (!isJsonObject(cell) || !isJsonString(cell.value)) return undefined;
      return cell.type === "uri" ? cell.value.slice(cell.value.lastIndexOf("/") + 1) : cell.value;
    };
    const item = read("item");
    if (!item || !ENTITY_ID.test(item)) continue;
    rows.push({
      item,
      // English first; `mul` is the language-neutral default many film items carry.
      label: read("en") ?? read("mul") ?? read("label"),
      movie: read("movie"),
      tv: read("tv"),
      date: read("date"),
      anime: read("anime"),
      links: read("links"),
    });
  }
  return rows;
}

export function buildWikidataTitleQuery(entityIds: readonly string[]): string {
  const values = entityIds.map((id) => `wd:${id}`).join(" ");
  const animeClasses = ANIME_CLASSES.map((id) => `wd:${id}`).join(" ");
  // `mul` is Wikidata's language-neutral default label; many film items carry
  // only that, so an English-only filter would drop their titles.
  return `SELECT ?item ?movie ?tv ?links (SAMPLE(?enLabel) AS ?en) (SAMPLE(?mulLabel) AS ?mul) (MIN(?d) AS ?date) (MAX(?isAnime) AS ?anime) WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item wdt:P4947 ?movie }
  OPTIONAL { ?item wdt:P4983 ?tv }
  OPTIONAL { ?item wdt:P577|wdt:P580 ?d }
  OPTIONAL { ?item rdfs:label ?enLabel FILTER(LANG(?enLabel) = "en") }
  OPTIONAL { ?item rdfs:label ?mulLabel FILTER(LANG(?mulLabel) = "mul") }
  BIND(EXISTS { ?item wdt:P31|wdt:P136 ?class . VALUES ?class { ${animeClasses} } } AS ?isAnime)
  ?item wikibase:sitelinks ?links
} GROUP BY ?item ?movie ?tv ?links`;
}

/**
 * Rows → search results. An item with both a movie and a TV id yields both
 * entries; one TMDB id reached from two items is kept once. Exact title
 * matches come first, then the most-linked (most notable) titles.
 */
export function wikidataRowsToSearchResults(
  query: string,
  rows: readonly WikidataTitleRow[],
): SearchResult[] {
  const wanted = normalizeTitle(query);
  const candidates: {
    readonly result: SearchResult;
    readonly exact: boolean;
    readonly links: number;
  }[] = [];
  for (const row of rows) {
    const title = row.label?.trim();
    if (!title) continue;
    const year = row.date?.match(/^-?(\d{4})/)?.[1] ?? "";
    const links = Number.parseInt(row.links ?? "0", 10);
    const isAnime = row.anime === "true" || row.anime === "1";
    const entries: { readonly id: string | undefined; readonly type: "movie" | "series" }[] = [
      { id: row.movie, type: "movie" },
      { id: row.tv, type: "series" },
    ];
    for (const entry of entries) {
      if (!entry.id || !TMDB_ID.test(entry.id)) continue;
      candidates.push({
        exact: normalizeTitle(title) === wanted,
        links: Number.isFinite(links) ? links : 0,
        result: {
          id: entry.id,
          type: entry.type,
          title,
          year,
          overview: "",
          posterPath: null,
          metadataSource: "Wikidata",
          isAnime,
          externalIds: { tmdbId: entry.id },
        },
      });
    }
  }
  // Rank first, then keep the best-ranked row per TMDB id: an exact-title row
  // must not lose to an earlier non-exact row for the same id.
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  const ranked = candidates.sort(
    (left, right) => Number(right.exact) - Number(left.exact) || right.links - left.links,
  );
  for (const candidate of ranked) {
    const key = `${candidate.result.type}:${candidate.result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(candidate.result);
    if (results.length === MAX_RESULTS) break;
  }
  return results;
}

/**
 * Movie and series titles matching `query`, identified by TMDB id. Resolves
 * `[]` for an honest "no match"; rejects with `WikidataSearchUnavailableError`
 * when Wikidata cannot answer, and with the caller's abort reason on cancel.
 */
export async function searchWikidataTmdbTitles(
  query: string,
  options: WikidataSearchOptions = {},
): Promise<SearchResult[]> {
  const text = query.trim();
  if (!text) return [];
  const headers = { "user-agent": WIKIDATA_USER_AGENT, accept: "application/json" };

  const searchUrl = new URL(WIKIDATA_API);
  searchUrl.search = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: `${text} haswbstatement:P4947|P4983`,
    srlimit: String(SEARCH_LIMIT),
    srprop: "",
    format: "json",
  }).toString();
  const entityIds = readSearchEntityIds(
    await fetchJson(searchUrl.toString(), { headers }, SEARCH_TIMEOUT_MS, options, "search"),
  );
  if (entityIds.length === 0) return [];

  const rows = readSparqlRows(
    await fetchJson(
      WIKIDATA_SPARQL,
      {
        method: "POST",
        headers: {
          ...headers,
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query: buildWikidataTitleQuery(entityIds) }).toString(),
      },
      SPARQL_TIMEOUT_MS,
      options,
      "query",
    ),
  );
  return wikidataRowsToSearchResults(text, rows);
}
