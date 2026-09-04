import {
  RELAY_HOP_HEADER,
  type ProviderRuntimeContext,
  type ResolveErrorCode,
  type StartupPriority,
} from "@kunai/types";

import type { AnimeEpisodeMetadata } from "../shared/anime-metadata";
import {
  curlCipherArgs,
  isCloudflareChallengeText,
  resolveCurlCandidate,
  type CurlCandidate,
  type CurlEnvironment,
} from "../shared/curl-impersonate";
import { expandHlsMasterPlaylist } from "../shared/hls-ladder";
import { markupToPlainText } from "../shared/markup-text";
import { TTLCache } from "../shared/provider-cache";
import {
  BALANCED_QUALITY_WAIT_BUDGET_MS,
  QUALITY_FIRST_WAIT_BUDGET_MS,
} from "../shared/startup-selection";
import { createTimeoutSignal } from "../shared/timeout-signal";
import { anidbNumericId, parseAnidbBrowseHtml, type AnidbSearchResult } from "./browse-parser";

export {
  anidbNumericId,
  chooseAnidbSearchMatch,
  looksLikeAnidbShowId,
  parseAnidbBrowseHtml,
  parseAnidbSeasonEvidence,
  type AnidbSearchResult,
  type AnidbSeasonEvidence,
} from "./browse-parser";

export const ANIDB_BASE = "https://anidb.app";
export const ANIDB_REFERER = "https://anidb.app/";
/**
 * Official AniDB HTTP API. Read-only, one request per series, cached for a
 * month: AniDB's terms are strict about repeat traffic and it answers abuse by
 * banning the client name, so nothing here may run per episode or per playback.
 */
export const ANIDB_HTTP_API = "http://api.anidb.net:9001/httpapi";
export const ANIDB_HTTP_API_CLIENT = "anidb";
export const ANIDB_HTTP_API_CLIENT_VERSION = "1";
export const ANIDB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const episodeCache = new TTLCache<string, AnidbEpisodeCatalog>(1_800_000);
/** A miss is cached far shorter than a hit: reindexes are permanent, 404s from a hiccup are not. */
const ANIDB_MISSING_CATALOG_TTL_MS = 120_000;
const languageCache = new TTLCache<string, readonly AnidbLanguageEntry[]>(300_000);
const malCache = new TTLCache<string, number | null>(3_600_000);
const externalIdsCache = new TTLCache<
  string,
  {
    readonly malId: number | null;
    readonly anilistId: string | null;
    readonly officialAid: number | null;
    readonly posterUrl: string | null;
  }
>(3_600_000);
const officialEpisodeMetadataCache = new TTLCache<
  string,
  ReadonlyMap<number, AnimeEpisodeMetadata>
>(30 * 24 * 60 * 60 * 1000);

export type AnidbEpisodeEntry = {
  readonly id: number;
  readonly number: number;
  readonly filler?: boolean;
};

export type AnidbLanguageEntry = {
  readonly code: string;
  readonly name: string;
  readonly embedUrl: string;
};

export type AnidbStreamLink = {
  readonly url: string;
  readonly quality: string;
  readonly audioMode: "sub" | "dub";
  readonly referer: string;
  readonly protocol: "hls";
  readonly container: "m3u8";
};

export type AnidbAudioMode = "sub" | "dub";

export type AnidbModeOutcome =
  | {
      readonly mode: AnidbAudioMode;
      readonly status: "resolved";
      readonly links: readonly AnidbStreamLink[];
    }
  | {
      readonly mode: AnidbAudioMode;
      readonly status: "catalog-unavailable" | "skipped";
      readonly links: readonly [];
    }
  | {
      readonly mode: AnidbAudioMode;
      readonly status: "failed" | "timed-out";
      readonly links: readonly [];
      readonly failure: {
        readonly code: ResolveErrorCode;
        readonly message: string;
        readonly retryable: true;
      };
    };

export type AnidbEpisodeStreamResolution = {
  readonly availableModes: readonly AnidbAudioMode[];
  readonly requested: AnidbModeOutcome;
  readonly alternate?: AnidbModeOutcome;
};

/**
 * curl-impersonate resolution lives in `shared/curl-impersonate.ts`, which
 * discovers wrappers from PATH rather than matching a fixed list (Miruro's
 * Cloudflare pipe fallback shares it). Keep the anidb-named exports as thin
 * delegates for the existing consumers.
 */
export const anidbCipherArgs = curlCipherArgs;

export function resolveAnidbCurl(environment: Partial<CurlEnvironment> = {}): CurlCandidate | null {
  return resolveCurlCandidate(environment);
}

/**
 * anidb.app HTML/JSON often CF-blocks Bun fetch. Prefer curl with a browser UA.
 * An impersonate build is used when one is on PATH; plain curl is the fallback
 * and is frequently still challenged, since Cloudflare fingerprints the TLS
 * handshake rather than trusting the User-Agent.
 */
/**
 * An AniDB HTTP status a caller is allowed to branch on.
 *
 * `anidb.app` reindexes slugs, so "this id is gone" (404) and "this id is
 * blocked right now" (403 / Cloudflare) demand opposite responses: re-search
 * for the first, keep the id and surface a retryable error for the second.
 * Reading that distinction back out of a message string is how it gets lost,
 * so the status rides on the error.
 */
export class AnidbHttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    // Message shape preserved from the untyped throw this replaces.
    super(`anidb fetch HTTP ${status}`);
    this.name = "AnidbHttpStatusError";
    this.status = status;
  }
}

/** curl reports the final status after redirects; the body keeps the rest. */
const ANIDB_STATUS_WRITE_OUT = ["-w", "\n%{http_code}"] as const;

function splitAnidbStatus(stdout: string): { readonly body: string; readonly status: number } {
  const cut = stdout.lastIndexOf("\n");
  if (cut < 0) return { body: "", status: Number.parseInt(stdout, 10) || 0 };
  const status = Number.parseInt(stdout.slice(cut + 1), 10);
  return { body: stdout.slice(0, cut), status: Number.isFinite(status) ? status : 0 };
}

export async function anidbFetchText(
  url: string,
  options: {
    readonly context?: ProviderRuntimeContext;
    readonly signal?: AbortSignal;
    readonly maxTimeSec?: number;
    /**
     * Turn an HTTP error status into an {@link AnidbHttpStatusError} instead of
     * an opaque failure. Only the JSON API reads need it; HTML scrapes are
     * happier with the existing best-effort behaviour.
     */
    readonly reportStatus?: boolean;
  } = {},
): Promise<string> {
  if (options.context?.fetch) {
    try {
      const response = await options.context.fetch.fetch(url, {
        headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
        signal: createTimeoutSignal(options.signal, 15_000),
      });
      if (response.ok) {
        const text = await response.text();
        if (!isCloudflareChallengeText(text)) {
          return text;
        }
      } else if (
        options.reportStatus === true &&
        response.status === 404 &&
        response.headers.get(RELAY_HOP_HEADER) === null
      ) {
        // Falling through to curl exists so a Cloudflare challenge gets a
        // second chance with a better TLS fingerprint. A 404 straight from
        // anidb.app is not a fingerprint problem — curl would spend a request
        // to be told the same thing — so it is answered here.
        //
        // A 404 that arrived over a relay hop is a different fact. A relay
        // deployed before this provider existed answers `unknown-provider`
        // with a 404 of its own, and reading that as anidb.app's verdict marks
        // the catalogue permanently missing and caches the miss — which took
        // the whole anime lane down behind a stale relay while the same id
        // resolved fine over curl. Let curl settle it: a genuine 404 still
        // throws below, one request later.
        throw new AnidbHttpStatusError(404);
      }
    } catch (error) {
      if (error instanceof AnidbHttpStatusError) throw error;
      // A cancelled caller is not a fingerprint problem either. Without this
      // an abort during the context fetch is swallowed and the fallback spends
      // a whole curl request on work nobody is waiting for. Checked against
      // `options.signal` rather than the error shape, so the 15s internal
      // timeout still earns its second chance through curl.
      if (options.signal?.aborted === true) throw error;
      // Fallback to local curl/impersonate
    }
  }

  const curl = resolveAnidbCurl();
  if (!curl) {
    const response = await fetch(url, {
      headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
      signal: createTimeoutSignal(options.signal, 15_000),
    });
    if (!response.ok) {
      throw new AnidbHttpStatusError(response.status);
    }
    const text = await response.text();
    if (isCloudflareChallengeText(text)) {
      throw new Error("anidb blocked by Cloudflare (install curl)");
    }
    return text;
  }

  const maxTime = String(options.maxTimeSec ?? 12);
  const args = [
    curl.path,
    "-sL",
    "-A",
    ANIDB_USER_AGENT,
    "-H",
    `Referer: ${ANIDB_REFERER}`,
    "--max-time",
    maxTime,
    ...anidbCipherArgs(curl.impersonates),
    ...(options.reportStatus === true ? ANIDB_STATUS_WRITE_OUT : []),
    url,
  ];
  const stdout = await runAnidbCurlWithRetry(args, options.signal);
  // `-sL` has no `--fail`, so curl exits 0 and hands back the error page for a
  // 404. Without asking for the status explicitly the miss is indistinguishable
  // from a body that merely failed to parse, which is how a reindexed id used
  // to look exactly like an empty catalogue.
  if (options.reportStatus === true) {
    const { body, status } = splitAnidbStatus(stdout);
    if (status >= 400) throw new AnidbHttpStatusError(status);
    if (isCloudflareChallengeText(body)) {
      throw new Error("anidb blocked by Cloudflare (try curl-impersonate)");
    }
    return body;
  }
  if (isCloudflareChallengeText(stdout)) {
    throw new Error("anidb blocked by Cloudflare (try curl-impersonate)");
  }
  return stdout;
}

const ANIDB_CURL_TIMEOUT_EXIT_CODE = 28;

/** curl killed by SIGINT / SIGTERM — 128 + signal number. */
const ANIDB_CURL_SIGINT_EXIT_CODE = 130;
const ANIDB_CURL_SIGTERM_EXIT_CODE = 143;

/**
 * AniDB TTFB from constrained networks sits close to the curl budget, so a lone
 * timed-out attempt is usually transient congestion rather than a dead route.
 * Retry once on exit 28 (`--max-time` exceeded) only: every other exit code
 * (DNS, refused, TLS) fails deterministically and a retry would just double the
 * latency before the same error.
 */
export async function runAnidbCurlWithRetry(
  args: readonly string[],
  signal?: AbortSignal,
  spawnOnce: (
    args: readonly string[],
    signal?: AbortSignal,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }> = defaultSpawnOnce,
): Promise<string> {
  let result = await spawnOnce(args, signal);
  if (result.exitCode === ANIDB_CURL_TIMEOUT_EXIT_CODE) {
    result = await spawnOnce(args, signal);
  }
  if (result.exitCode !== 0) {
    // Quitting kunai mid-resolve kills curl, and "curl exit 130" matches
    // neither "abort" nor "cancel", so the failure classifier read a plain
    // Ctrl-C as an unknown network fault: retryable, worth a fallback provider,
    // and logged at ERROR. Say cancelled in the one place that knows the
    // process was signalled, so the existing cancellation handling applies.
    if (signal?.aborted === true) throw signal.reason ?? new Error("anidb curl cancelled");
    if (
      result.exitCode === ANIDB_CURL_SIGINT_EXIT_CODE ||
      result.exitCode === ANIDB_CURL_SIGTERM_EXIT_CODE
    ) {
      throw new Error(`anidb curl cancelled (exit ${result.exitCode})`);
    }
    throw new Error(result.stderr.trim() || `curl exit ${result.exitCode}`);
  }
  return result.stdout;
}

function defaultSpawnOnce(
  args: readonly string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([...args], {
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

export async function searchAnidb(
  query: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnidbSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const page = await anidbFetchText(`${ANIDB_BASE}/browse?q=${encodeURIComponent(trimmed)}`, {
    signal,
    context,
  });
  return parseAnidbBrowseHtml(page);
}

export async function fetchAnidbMalId(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<number | undefined> {
  // `null` is "this page has no MAL link", which is a real answer worth caching.
  // A cache miss is `undefined`, so the two must not share a representation or
  // every negative result re-scrapes AniDB on the resolve path.
  const cached = malCache.get(showId);
  if (cached !== undefined) return cached ?? undefined;

  const ids = await fetchAnidbExternalIds(showId, signal, context);
  if (!ids) return undefined;
  const result = ids?.malId ?? null;
  malCache.set(showId, result);
  return result ?? undefined;
}

export type AnidbExternalIds = {
  readonly malId?: number;
  readonly anilistId?: string;
  readonly officialAid?: number;
  readonly posterUrl?: string;
};

export async function fetchAnidbExternalIds(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<AnidbExternalIds | undefined> {
  const cached = externalIdsCache.get(showId);
  if (cached) {
    return {
      malId: cached.malId ?? undefined,
      anilistId: cached.anilistId ?? undefined,
      officialAid: cached.officialAid ?? undefined,
      posterUrl: cached.posterUrl ?? undefined,
    };
  }

  try {
    const page = await anidbFetchText(`${ANIDB_BASE}/anime/${encodeURIComponent(showId)}`, {
      signal,
      context,
    });
    const mal = /https:\/\/myanimelist\.net\/anime\/(\d+)/.exec(page)?.[1];
    const parsedMal = mal ? Number(mal) : NaN;
    const malId = Number.isFinite(parsedMal) && parsedMal > 0 ? parsedMal : null;
    const anilistId = /https:\/\/anilist\.co\/anime\/(\d+)/.exec(page)?.[1] ?? null;
    const official = /https:\/\/anidb\.net\/anime\/(\d+)/.exec(page)?.[1];
    const parsedOfficial = official ? Number(official) : NaN;
    const officialAid =
      Number.isFinite(parsedOfficial) && parsedOfficial > 0 ? parsedOfficial : null;
    const posterUrl = readMetaContent(page, "og:image") ?? null;
    externalIdsCache.set(showId, { malId, anilistId, officialAid, posterUrl });
    return {
      malId: malId ?? undefined,
      anilistId: anilistId ?? undefined,
      officialAid: officialAid ?? undefined,
      posterUrl: posterUrl ?? undefined,
    };
  } catch {
    // A transport failure says nothing about the show. Do not cache it or let a
    // Cloudflare block suppress metadata and auto-skip for the full TTL.
    return undefined;
  }
}

export async function fetchAnidbOfficialEpisodeMetadata(
  officialAid: number,
  signal?: AbortSignal,
): Promise<ReadonlyMap<number, AnimeEpisodeMetadata>> {
  const cacheKey = String(officialAid);
  const cached = officialEpisodeMetadataCache.get(cacheKey);
  if (cached) return new Map(cached);

  try {
    const response = await fetch(
      `${ANIDB_HTTP_API}?request=anime&client=${ANIDB_HTTP_API_CLIENT}&clientver=${ANIDB_HTTP_API_CLIENT_VERSION}&protover=1&aid=${officialAid}`,
      {
        headers: { Accept: "text/xml", "User-Agent": ANIDB_USER_AGENT },
        signal: createTimeoutSignal(signal, 15_000),
      },
    );
    if (!response.ok) return new Map();
    const xml = await response.text();
    // AniDB answers rate limits, bans, and bad client credentials with HTTP 200
    // and an <error> body. Caching what that parses to (nothing) would suppress
    // every episode title for this show for the full TTL, long after the block
    // lifted — so an empty read stays uncached and simply retries next time.
    if (/<error\b/i.test(xml)) return new Map();
    const metadata = parseAnidbOfficialEpisodeMetadata(xml);
    if (metadata.size === 0) return new Map();
    officialEpisodeMetadataCache.set(cacheKey, metadata);
    return new Map(metadata);
  } catch {
    return new Map();
  }
}

export function parseAnidbOfficialEpisodeMetadata(xml: string): Map<number, AnimeEpisodeMetadata> {
  const metadata = new Map<number, AnimeEpisodeMetadata>();
  const episodePattern = /<episode\b[^>]*>([\s\S]*?)<\/episode>/gi;
  let match: RegExpExecArray | null;
  while ((match = episodePattern.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const epno = readXmlElement(block, "epno");
    if (readXmlAttribute(epno.attributes, "type") !== "1") continue;
    const number = Number(epno.value);
    if (!Number.isInteger(number) || number < 1) continue;

    const title = readPreferredAnidbEpisodeTitle(block);
    const synopsis = readXmlElement(block, "summary").value;
    const airDate = readXmlElement(block, "airdate").value;
    metadata.set(number, {
      number,
      title: title || undefined,
      synopsis: synopsis || undefined,
      airDate: airDate || undefined,
      source: "anidb",
    });
  }
  return metadata;
}

function readPreferredAnidbEpisodeTitle(block: string): string {
  const titles = [...block.matchAll(/<title\b([^>]*)>([\s\S]*?)<\/title>/gi)].map((match) => ({
    language: readXmlAttribute(match[1] ?? "", "xml:lang"),
    value: normalizeXmlText(match[2] ?? ""),
  }));
  return (
    titles.find((title) => title.language === "en")?.value ??
    titles.find((title) => title.language === "x-jat")?.value ??
    titles[0]?.value ??
    ""
  );
}

function readXmlElement(
  block: string,
  name: string,
): { readonly attributes: string; readonly value: string } {
  const match = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return {
    attributes: match?.[1] ?? "",
    value: normalizeXmlText(match?.[2] ?? ""),
  };
}

function readXmlAttribute(attributes: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedName}\\s*=\\s*["']([^"']*)["']`, "i").exec(attributes)?.[1];
}

function normalizeXmlText(value: string): string {
  // Official summaries carry markup and numeric entities, and land straight in
  // terminal output. `markupToPlainText` is the same hardened path the browse
  // scraper uses: script spans first, then tags, entities decoded once, and no
  // decoded control character — `&#27;` must never become a live ESC byte.
  return markupToPlainText(value);
}

function readMetaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyFirst = new RegExp(
    `<meta\\b[^>]*property=["']${escaped}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta\\b[^>]*content=["']([^"']+)["'][^>]*property=["']${escaped}["']`,
    "i",
  );
  return propertyFirst.exec(html)?.[1] ?? contentFirst.exec(html)?.[1];
}

/**
 * An episode list, plus whether the show id itself resolved.
 *
 * `episodes: []` alone cannot carry this: a season announced but not yet
 * listed is legitimately empty, and treating that the same as a reindexed id
 * sends the caller off to search and hand back a *different show*. The two
 * need separate answers, so they get separate fields.
 */
export type AnidbEpisodeCatalog = {
  readonly episodes: readonly AnidbEpisodeEntry[];
  /** The id is gone (HTTP 404) — not merely empty. */
  readonly missing: boolean;
};

const ANIDB_EMPTY_CATALOG: AnidbEpisodeCatalog = { episodes: [], missing: false };
const ANIDB_MISSING_CATALOG: AnidbEpisodeCatalog = { episodes: [], missing: true };

export async function fetchAnidbEpisodeCatalog(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<AnidbEpisodeCatalog> {
  const numericId = anidbNumericId(showId);
  if (!numericId) return ANIDB_EMPTY_CATALOG;
  const cached = episodeCache.get(showId);
  if (cached) return cached;

  const url = `${ANIDB_BASE}/api/frontend/anime/${numericId}/episodes`;
  let text: string;
  try {
    text = await anidbFetchText(url, { signal, context, reportStatus: true });
  } catch (error) {
    // A reindexed slug (Solo Leveling 19413 → 4883) 404s permanently. Record
    // it as a miss so the caller can re-search, and cache it briefly so a dead
    // id is not re-requested once per call site on the same resolve.
    if (error instanceof AnidbHttpStatusError && error.status === 404) {
      episodeCache.set(showId, ANIDB_MISSING_CATALOG, ANIDB_MISSING_CATALOG_TTL_MS);
      return ANIDB_MISSING_CATALOG;
    }
    throw error;
  }
  let parsed: { episodes?: readonly Record<string, unknown>[] };
  try {
    parsed = JSON.parse(text) as { episodes?: readonly Record<string, unknown>[] };
  } catch {
    // Unparseable is not the same as absent: the id may be fine and the body
    // mangled, so this must not be reported as a miss.
    return ANIDB_EMPTY_CATALOG;
  }
  // `?? []` only covers null and undefined. A body like `{"episodes":{}}`
  // parses cleanly and then throws on `.flatMap`, turning malformed upstream
  // data into a crash rather than an empty listing. A non-array field is
  // empty-but-present, the same as an unparseable body: not a missing id.
  if (parsed.episodes !== undefined && !Array.isArray(parsed.episodes)) {
    return ANIDB_EMPTY_CATALOG;
  }
  const episodes = (parsed.episodes ?? [])
    .flatMap((entry) => {
      const id = typeof entry.id === "number" ? entry.id : Number(entry.id);
      const number = typeof entry.number === "number" ? entry.number : Number(entry.number);
      if (!Number.isFinite(id) || !Number.isFinite(number) || number <= 0) return [];
      const mapped: AnidbEpisodeEntry = {
        id,
        number,
        ...(entry.filler === true ? { filler: true } : {}),
      };
      return [mapped];
    })
    .sort((left, right) => left.number - right.number);

  const catalog: AnidbEpisodeCatalog = { episodes, missing: false };
  episodeCache.set(showId, catalog);
  return catalog;
}

/** Episode list only, for the callers that cannot act on a missing id. */
export async function fetchAnidbEpisodes(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnidbEpisodeEntry[]> {
  return (await fetchAnidbEpisodeCatalog(showId, signal, context)).episodes;
}

export async function fetchAnidbLanguages(
  episodeId: number,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnidbLanguageEntry[]> {
  const cacheKey = String(episodeId);
  const cached = languageCache.get(cacheKey);
  if (cached) return cached;

  const url = `${ANIDB_BASE}/api/frontend/episode/${episodeId}/languages`;
  let text: string;
  try {
    text = await anidbFetchText(url, { signal, context, reportStatus: true });
  } catch (error) {
    // No languages row for this episode is a real answer, not a failure.
    if (error instanceof AnidbHttpStatusError && error.status === 404) return [];
    throw error;
  }
  let parsed: { languages?: readonly Record<string, unknown>[] };
  try {
    parsed = JSON.parse(text) as { languages?: readonly Record<string, unknown>[] };
  } catch {
    return [];
  }
  const languages = (parsed.languages ?? [])
    .map((entry) => {
      const code = typeof entry.code === "string" ? entry.code : "";
      const name = typeof entry.name === "string" ? entry.name : code;
      const embedRaw =
        typeof entry.embed_url === "string"
          ? entry.embed_url
          : typeof entry.embedUrl === "string"
            ? entry.embedUrl
            : "";
      const embedUrl = embedRaw.replace(/\\\//g, "/").trim();
      if (!code || !embedUrl) return null;
      return { code, name, embedUrl } satisfies AnidbLanguageEntry;
    })
    .filter((entry): entry is AnidbLanguageEntry => entry !== null);

  languageCache.set(cacheKey, languages);
  return languages;
}

/**
 * Inspect which audio modes (sub/dub) are available for an episode by checking
 * the language codes returned by the AniDB language API.
 *
 * Mirrors ani-cli parity: `jpn` → sub, `eng` → dub (ani-cli line 186-187).
 */
export async function collectAnidbAvailableAudioModes(
  episodeId: number,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly ("sub" | "dub")[]> {
  const languages = await fetchAnidbLanguages(episodeId, signal, context);
  const modes: ("sub" | "dub")[] = [];
  // Exact `jpn`/`eng` only — `kor`/future codes are runtime evidence, not a
  // third audio mode. Case-insensitive to match `languageEntryForMode`.
  if (languages.some((entry) => entry.code.toLowerCase() === "jpn")) modes.push("sub");
  if (languages.some((entry) => entry.code.toLowerCase() === "eng")) modes.push("dub");
  return modes;
}

export async function fetchAnidbMasterUrl(
  embedUrl: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<string | null> {
  const page = await anidbFetchText(embedUrl, { signal, context });
  const match = /file:\s*'([^']+)'/.exec(page);
  return match?.[1]?.trim() || null;
}

/**
 * Resolves HLS ladder stream links for a single AniDB language embed.
 */
export async function resolveAnidbLanguageStreams(options: {
  readonly context?: ProviderRuntimeContext;
  readonly language: AnidbLanguageEntry;
  readonly audioMode: "sub" | "dub";
  readonly signal?: AbortSignal;
}): Promise<readonly AnidbStreamLink[]> {
  const masterUrl = await fetchAnidbMasterUrl(
    options.language.embedUrl,
    options.signal,
    options.context,
  );
  if (!masterUrl) return [];

  const variants = await expandHlsMasterPlaylist({
    fetch: async (url: string, init?: RequestInit) => {
      const text = await anidbFetchText(url, {
        signal: (init?.signal instanceof AbortSignal ? init.signal : undefined) ?? options.signal,
        context: options.context,
      });
      return new Response(text, {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    },
    masterUrl,
    headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
    signal: options.signal,
  });

  return variants.map((variant) => ({
    url: variant.url,
    quality: variant.qualityLabel,
    audioMode: options.audioMode,
    referer: ANIDB_REFERER,
    protocol: "hls" as const,
    container: "m3u8" as const,
  }));
}

/**
 * Resolves episode streams for all available languages in parallel so that
 * the resulting inventory contains real, playable streams for every mode
 * (e.g. sub and dub) supported by the AniDB episode.
 */
export async function resolveAnidbEpisodeStreams(options: {
  readonly context?: ProviderRuntimeContext;
  readonly showId: string;
  readonly episodeNumber: number;
  readonly requestedMode: AnidbAudioMode;
  readonly startupPriority?: StartupPriority;
  readonly alternateWaitBudgetMs?: number;
  readonly signal?: AbortSignal;
}): Promise<AnidbEpisodeStreamResolution> {
  const episodes = await fetchAnidbEpisodes(options.showId, options.signal, options.context);
  const episode = episodes.find((entry) => entry.number === options.episodeNumber);
  if (!episode) {
    return {
      availableModes: [],
      requested: {
        mode: options.requestedMode,
        status: "catalog-unavailable",
        links: [],
      },
    };
  }

  const languages = await fetchAnidbLanguages(episode.id, options.signal, options.context);
  const availableModes = (["sub", "dub"] as const).filter((mode) =>
    Boolean(languageEntryForMode(languages, mode)),
  );
  const requestedLanguage = languageEntryForMode(languages, options.requestedMode);
  if (!requestedLanguage) {
    return {
      availableModes,
      requested: {
        mode: options.requestedMode,
        status: "catalog-unavailable",
        links: [],
      },
    };
  }

  const alternateMode: AnidbAudioMode = options.requestedMode === "sub" ? "dub" : "sub";
  const alternateLanguage = languageEntryForMode(languages, alternateMode);
  const waitBudgetMs =
    options.alternateWaitBudgetMs ?? anidbAlternateWaitBudgetMs(options.startupPriority);
  const alternateController = alternateLanguage && waitBudgetMs > 0 ? new AbortController() : null;
  const removeCallerListener = alternateController
    ? linkAbortSignal(options.signal, alternateController)
    : () => undefined;
  const alternatePromise =
    alternateLanguage && alternateController
      ? settleAnidbLanguage({
          context: options.context,
          language: alternateLanguage,
          mode: alternateMode,
          signal: alternateController.signal,
          callerSignal: options.signal,
        })
      : null;
  // When the wait budget expires and the caller has already aborted,
  // `settleAlternateWithinBudget` throws before it attaches its own handler, so
  // this rejection would surface as an unhandled rejection. The awaiting
  // consumer still receives the original promise's outcome.
  void alternatePromise?.catch(() => undefined);

  const requested = await settleAnidbLanguage({
    context: options.context,
    language: requestedLanguage,
    mode: options.requestedMode,
    signal: options.signal,
    callerSignal: options.signal,
  });
  if (requested.status !== "resolved") {
    alternateController?.abort("requested-mode-failed");
    await alternatePromise?.catch(() => undefined);
    removeCallerListener();
    return { availableModes, requested };
  }

  if (!alternateLanguage) {
    removeCallerListener();
    return { availableModes, requested };
  }
  if (!alternatePromise || !alternateController) {
    removeCallerListener();
    return {
      availableModes,
      requested,
      alternate: { mode: alternateMode, status: "skipped", links: [] },
    };
  }

  try {
    const alternate = await settleAlternateWithinBudget({
      promise: alternatePromise,
      controller: alternateController,
      waitBudgetMs,
      mode: alternateMode,
      callerSignal: options.signal,
    });
    return { availableModes, requested, alternate };
  } finally {
    removeCallerListener();
  }
}

export function anidbAlternateWaitBudgetMs(priority: StartupPriority = "balanced"): number {
  if (priority === "fast") return 0;
  return priority === "quality-first"
    ? QUALITY_FIRST_WAIT_BUDGET_MS
    : BALANCED_QUALITY_WAIT_BUDGET_MS;
}

function languageEntryForMode(
  languages: readonly AnidbLanguageEntry[],
  mode: AnidbAudioMode,
): AnidbLanguageEntry | undefined {
  const code = mode === "dub" ? "eng" : "jpn";
  return languages.find((entry) => entry.code.toLowerCase() === code);
}

async function settleAnidbLanguage(options: {
  readonly context?: ProviderRuntimeContext;
  readonly language: AnidbLanguageEntry;
  readonly mode: AnidbAudioMode;
  readonly signal?: AbortSignal;
  readonly callerSignal?: AbortSignal;
}): Promise<AnidbModeOutcome> {
  try {
    const links = await resolveAnidbLanguageStreams({
      context: options.context,
      language: options.language,
      audioMode: options.mode,
      signal: options.signal,
    });
    if (options.callerSignal?.aborted) throw options.callerSignal.reason;
    if (links.length > 0) return { mode: options.mode, status: "resolved", links };
    return {
      mode: options.mode,
      status: "failed",
      links: [],
      failure: {
        code: "parse-failed",
        message: `AniDB ${options.mode} source did not expose a playable HLS stream`,
        retryable: true,
      },
    };
  } catch (error) {
    if (options.callerSignal?.aborted) throw error;
    return {
      mode: options.mode,
      status: "failed",
      links: [],
      failure: {
        code: "network-error",
        message: error instanceof Error ? error.message : `AniDB ${options.mode} source failed`,
        retryable: true,
      },
    };
  }
}

async function settleAlternateWithinBudget(options: {
  readonly promise: Promise<AnidbModeOutcome>;
  readonly controller: AbortController;
  readonly waitBudgetMs: number;
  readonly mode: AnidbAudioMode;
  readonly callerSignal?: AbortSignal;
}): Promise<AnidbModeOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), options.waitBudgetMs);
  });
  try {
    const result = await Promise.race([
      options.promise.then((outcome) => ({ outcome }) as const),
      timeout,
    ]);
    if (options.callerSignal?.aborted) throw options.callerSignal.reason;
    if (result !== "timed-out") return result.outcome;

    options.controller.abort("alternate-inventory-timeout");
    await options.promise.catch(() => undefined);
    if (options.callerSignal?.aborted) throw options.callerSignal.reason;
    return {
      mode: options.mode,
      status: "timed-out",
      links: [],
      failure: {
        code: "timeout",
        message: `AniDB ${options.mode} alternate source exceeded its inventory budget`,
        retryable: true,
      },
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => undefined;
  }
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export function clearAnidbCachesForTest(): void {
  episodeCache.clear();
  languageCache.clear();
  malCache.clear();
  externalIdsCache.clear();
  officialEpisodeMetadataCache.clear();
}
