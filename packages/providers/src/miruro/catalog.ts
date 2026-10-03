/**
 * Miruro catalog API client — `/api/v1/*`, the successor to the dead
 * `/api/secure/pipe` transport (removed upstream 2026-10; every mirror now
 * serves a SPA 404 under that route).
 *
 * Three measured facts about this API (2026-10-03):
 *
 * 1. **Bodies are XOR-gzipped.** Successful responses are
 *    `application/octet-stream`: every byte XORed with the ASCII key
 *    `miruro/catalog`, the result gzip'd JSON. Errors are plain
 *    `application/problem+json` (RFC 7807) and are NOT transformed.
 *
 * 2. **Query shapes are allowlisted.** The backend answers 400
 *    "Unsupported catalog request" for any parameter set the site's own code
 *    does not send — `limit` must be exactly the app's page size for that
 *    call (5/15 search, 100 lookup, 10000 episodes), `episodes` requires
 *    `kind`, and `play` accepts no query at all. This is a request-shape
 *    gate, not a WAF: plain `fetch` clears it; no curl leg is needed.
 *
 * 3. **Requests must look like the site.** The guard also wants the browser
 *    header set (UA + Accept + Accept-Language + a referer that is a real
 *    site page). Bun fetch passes all of this — the old pipe's TLS-fingerprint
 *    Cloudflare block does not apply here.
 */

/* oxlint-disable anti-slop/no-runtime-typeof anti-slop/no-unknown-parameters anti-slop/no-unknown-returns anti-slop/no-unsafe-dictionary-type -- this module IS the I/O-boundary parser for the catalog's XOR-gzipped, untyped upstream JSON; the duck-type probes establish the contract (providers carry no schema-runtime dep) */

import type { ProviderRuntimeContext } from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import { miruroBaseUrls, recordMiruroMirrorSuccess } from "./mirrors";

const CATALOG_OBFUSCATION_KEY = new TextEncoder().encode("miruro/catalog");

const CATALOG_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Search/navbar page size; one of the two allowlisted `limit` values for `q` queries. */
export const MIRURO_CATALOG_SEARCH_LIMIT = 15;
/** Identity-lookup page size; the only allowlisted `limit` for `*_id_in` queries. */
export const MIRURO_CATALOG_LOOKUP_LIMIT = 100;
/** Episode-list page size; the only allowlisted `limit` for `episodes`. */
export const MIRURO_CATALOG_EPISODES_LIMIT = 10_000;

export class MiruroCatalogError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(status: number, detail?: string) {
    super(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
    this.name = "MiruroCatalogError";
    this.status = status;
    this.detail = detail;
  }
}

function buildCatalogHeaders(baseUrl: string, refererPath: string) {
  return {
    "user-agent": CATALOG_USER_AGENT,
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    referer: `${baseUrl}${refererPath}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * XOR+gunzip an `application/octet-stream` catalog body. Passes problem+json
 * and other plain bodies through untouched so error handling stays legible.
 */
export async function decodeMiruroCatalogBody(
  body: Uint8Array,
  contentType: string | null,
): Promise<unknown> {
  const type = contentType?.split(";", 1)[0]?.trim() ?? "";
  if (type !== "application/octet-stream") {
    const text = new TextDecoder().decode(body);
    return text ? JSON.parse(text) : null;
  }
  const decoded = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i += 1) {
    decoded[i] =
      (body[i] ?? 0) ^ (CATALOG_OBFUSCATION_KEY[i % CATALOG_OBFUSCATION_KEY.length] ?? 0);
  }
  const plain = await new Response(
    new Blob([decoded]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  return JSON.parse(plain);
}

function readProblemDetail(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const detail = value["detail"];
  return typeof detail === "string" && detail.trim() ? detail.trim() : undefined;
}

async function fetchCatalogOnce(
  baseUrl: string,
  path: string,
  query: Record<string, string> | undefined,
  refererPath: string,
  context: ProviderRuntimeContext,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  const url = `${baseUrl}/api${path}${qs}`;
  const response = await providerFetch(context, url, {
    headers: buildCatalogHeaders(baseUrl, refererPath),
    signal,
  });
  const body = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    // Errors are problem+json, but a non-2xx can also be a SPA fallback page
    // or an empty edge response — decode only to mine the detail, and never
    // let an undecodable error body demote the status to a SyntaxError.
    let detail: string | undefined;
    try {
      detail = readProblemDetail(
        await decodeMiruroCatalogBody(body, response.headers.get("content-type")),
      );
    } catch {
      detail = undefined;
    }
    throw new MiruroCatalogError(response.status, detail);
  }
  return decodeMiruroCatalogBody(body, response.headers.get("content-type"));
}

/**
 * Walk the mirror list for one catalog call. Mirrors still differ in
 * reachability per network (`.to` was TLS-dead while `.bz`/`.ru`/`.tv`
 * answered on 2026-10-03), so the order/status-page machinery in
 * `mirrors.ts` applies unchanged — only the path and wire format changed.
 */
export async function fetchMiruroCatalog(
  context: ProviderRuntimeContext,
  path: string,
  options: {
    readonly query?: Record<string, string>;
    readonly refererPath?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const baseUrls = miruroBaseUrls({
    fetchImpl: context.fetch?.fetch.bind(context.fetch),
  });
  const refererPath = options.refererPath ?? "/";
  let lastError: unknown;
  for (const baseUrl of baseUrls) {
    try {
      const result = await fetchCatalogOnce(
        baseUrl,
        path,
        options.query,
        refererPath,
        context,
        options.signal ?? context.signal,
      );
      recordMiruroMirrorSuccess(baseUrl);
      return result;
    } catch (error) {
      if ((options.signal ?? context.signal)?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/* ------------------------------------------------------------------ */
/* Response types                                                      */
/* ------------------------------------------------------------------ */

export type MiruroCatalogExternalIds = {
  readonly anilist?: readonly string[];
  readonly mal?: readonly string[];
  readonly kitsu?: readonly string[];
  readonly anidb?: readonly string[];
  readonly tvdb?: readonly string[];
  readonly imdb?: readonly string[];
  readonly tmdb_tv?: readonly string[];
};

export type MiruroCatalogAnime = {
  readonly id: string;
  readonly external_ids?: MiruroCatalogExternalIds;
  readonly title?: {
    readonly romaji?: string | null;
    readonly english?: string | null;
    readonly native?: string | null;
  };
  readonly format?: string | null;
  readonly status?: string | null;
  readonly episode_count?: number | null;
  readonly episode_counts?: {
    readonly raw?: number | null;
    readonly sub?: number | null;
    readonly dub?: number | null;
  };
  readonly episode_duration_minutes?: number | null;
  readonly average_score?: number | null;
  readonly popularity?: number | null;
  readonly season_year?: number | null;
  readonly season?: string | null;
  readonly is_adult?: boolean | null;
  readonly description?: string | null;
  readonly cover_image?: {
    readonly large?: string | null;
    readonly extra_large?: string | null;
  } | null;
  readonly banner_image?: string | null;
};

export type MiruroCatalogListResponse = {
  readonly data?: readonly MiruroCatalogAnime[];
  readonly has_more?: boolean;
  readonly next_cursor?: string | null;
};

export type MiruroCatalogEpisode = {
  readonly episode_number: number;
  readonly absolute_number?: number | null;
  readonly kind?: string | null;
  readonly canon_type?: string | null;
  readonly title?: string | null;
  readonly synopsis?: string | null;
  readonly thumbnail_url?: string | null;
  readonly air_date?: string | null;
  readonly duration_seconds?: number | null;
};

export type MiruroCatalogEpisodesResponse = {
  readonly data?: readonly MiruroCatalogEpisode[];
  readonly has_more?: boolean;
};

export type MiruroCatalogStream = {
  readonly url?: string;
  readonly format?: string | null;
  readonly quality?: string | null;
  readonly resolution?: { readonly width?: number; readonly height?: number } | null;
  readonly codec?: string | null;
  readonly embed?: { readonly url?: string } | null;
};

export type MiruroCatalogServer = {
  readonly server?: string;
  readonly headers?: Record<string, string> | null;
  readonly streams?: readonly MiruroCatalogStream[] | null;
  readonly embed?: { readonly url?: string } | null;
};

export type MiruroCatalogSubtitle = {
  readonly file?: string;
  readonly url?: string;
  readonly label?: string;
  readonly language?: string;
  readonly default?: boolean;
};

export type MiruroCatalogDownload = {
  readonly url?: string;
  readonly quality?: string;
  readonly size?: string;
  readonly fansub?: string;
};

export type MiruroCatalogProvider = {
  readonly provider?: string;
  readonly subtitles?: readonly MiruroCatalogSubtitle[] | null;
  readonly thumbnails?: readonly { readonly url?: string; readonly file?: string }[] | null;
  readonly downloads?: readonly MiruroCatalogDownload[] | null;
  readonly servers?: readonly MiruroCatalogServer[] | null;
};

export type MiruroCatalogTrack = {
  readonly track?: string;
  readonly providers?: readonly MiruroCatalogProvider[] | null;
};

export type MiruroCatalogPlayResponse = {
  readonly episode_number?: number;
  readonly requested_track?: string | null;
  readonly skip_times?:
    | readonly {
        readonly kind?: string;
        readonly start_seconds?: number;
        readonly end_seconds?: number;
      }[]
    | null;
  readonly tracks?: readonly MiruroCatalogTrack[] | null;
};

/* ------------------------------------------------------------------ */
/* Typed endpoints — keep the allowlisted query shapes in one place.    */
/* ------------------------------------------------------------------ */

function readListResponse(value: unknown): MiruroCatalogListResponse {
  // SAFETY: isRecord proved an object; field readers below tolerate missing keys.
  return isRecord(value) ? (value as MiruroCatalogListResponse) : {};
}

/** `/v1/anime` search — the navbar shape: `q`, `limit` ∈ {5,15}, `sort`. */
export async function searchMiruroCatalog(
  context: ProviderRuntimeContext,
  query: string,
  signal?: AbortSignal,
): Promise<readonly MiruroCatalogAnime[]> {
  const value = await fetchMiruroCatalog(context, "/v1/anime", {
    query: { q: query, limit: String(MIRURO_CATALOG_SEARCH_LIMIT), sort: "-popularity" },
    refererPath: "/search?sort=POPULARITY_DESC",
    signal,
  });
  return readListResponse(value).data ?? [];
}

/**
 * `/v1/anime` identity lookup — `anilist_id_in`/`mal_id_in` must ride with
 * `limit=100` (`Ms.lookup` in the app); any other page size is rejected.
 */
export async function lookupMiruroAnimeByAnilist(
  context: ProviderRuntimeContext,
  anilistId: string,
  signal?: AbortSignal,
): Promise<MiruroCatalogAnime | null> {
  const value = await fetchMiruroCatalog(context, "/v1/anime", {
    query: { anilist_id_in: anilistId, limit: String(MIRURO_CATALOG_LOOKUP_LIMIT) },
    signal,
  });
  return readListResponse(value).data?.[0] ?? null;
}

/** `/v1/anime/:id/episodes` — `kind` (`regular`|`film`) + `limit=10000`. */
export async function listMiruroCatalogEpisodes(
  context: ProviderRuntimeContext,
  catalogId: string,
  options: { readonly kind?: "regular" | "film"; readonly signal?: AbortSignal } = {},
): Promise<readonly MiruroCatalogEpisode[]> {
  const value = await fetchMiruroCatalog(
    context,
    `/v1/anime/${encodeURIComponent(catalogId)}/episodes`,
    {
      query: { kind: options.kind ?? "regular", limit: String(MIRURO_CATALOG_EPISODES_LIMIT) },
      refererPath: "/watch",
      signal: options.signal,
    },
  );
  // SAFETY: isRecord proved an object; `data` is read defensively next.
  const parsed = isRecord(value) ? (value as MiruroCatalogEpisodesResponse) : {};
  return parsed.data ?? [];
}

/** `/v1/anime/:id/episodes/:n/play` — the one-call track/provider/server matrix. */
export async function fetchMiruroPlay(
  context: ProviderRuntimeContext,
  catalogId: string,
  episodeNumber: number,
  signal?: AbortSignal,
): Promise<MiruroCatalogPlayResponse> {
  const value = await fetchMiruroCatalog(
    context,
    `/v1/anime/${encodeURIComponent(catalogId)}/episodes/${encodeURIComponent(String(episodeNumber))}/play`,
    { refererPath: "/watch", signal },
  );
  // SAFETY: isRecord proved an object; callers read play fields defensively.
  return isRecord(value) ? (value as MiruroCatalogPlayResponse) : {};
}
