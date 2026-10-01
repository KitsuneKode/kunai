import type { ProviderRuntimeContext, ResolveErrorCode, StartupPriority } from "@kunai/types";
import {
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  ProviderHttpError,
} from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import type { AnimeEpisodeMetadata } from "../shared/anime-metadata";
import {
  curlCipherArgs,
  resolveCurlCandidate,
  type CurlCandidate,
  type CurlEnvironment,
} from "../shared/curl-impersonate";
import { expandHlsMasterInventory, isHlsDeadHostStatus } from "../shared/hls-ladder";
import { markupToPlainText } from "../shared/markup-text";
import { TTLCache } from "../shared/provider-cache";
import {
  providerFetchText,
  runProviderCurlWithRetry,
  type SpawnCurlOnce,
} from "../shared/provider-http-transport";
import {
  BALANCED_QUALITY_WAIT_BUDGET_MS,
  QUALITY_FIRST_WAIT_BUDGET_MS,
} from "../shared/startup-selection";
import { createTimeoutSignal } from "../shared/timeout-signal";
import { anidbNumericId, parseAnidbBrowseHtml, type AnidbSearchResult } from "./browse-parser";
import { ANIDB_PROVIDER_ID } from "./manifest";

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

// External ids and official episode numbers are effectively immutable — a
// MAL/AniList link or an episode title doesn't change between sessions, so
// they persist through `context.cache` (SQLite) and the process-local TTLMap
// stays as L1. Neither is signed or session-scoped.
const ANIDB_EXTERNAL_IDS_NAMESPACE = "anidb:external-ids";
const ANIDB_EXTERNAL_IDS_PERSIST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ANIDB_OFFICIAL_EPISODES_NAMESPACE = "anidb:official-episodes";
const ANIDB_OFFICIAL_EPISODES_PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
        readonly retryable: boolean;
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
export class AnidbHttpStatusError extends ProviderHttpError {
  override readonly name = "AnidbHttpStatusError";
  declare readonly status: number;

  constructor(status: number) {
    super({
      // Message shape preserved from the untyped throw this replaces.
      message: `anidb fetch HTTP ${status}`,
      status,
      code: httpStatusToResolveErrorCode(status),
      retryable: httpStatusIsRetryable(status),
    });
  }
}

/**
 * A Cloudflare challenge that every available transport has already failed to
 * clear. Typed rather than message-matched so the failure classifier can tell
 * "blocked" from "the network is down" without reading prose: a challenge is
 * not a network fault, and retrying it cannot succeed.
 */
export class AnidbBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnidbBlockedError";
  }
}

/**
 * The remediation to suggest, given what actually ran. Telling a user on
 * curl-impersonate to install curl-impersonate is the advice they already
 * followed, and it is the advice that makes a blocked provider look like a
 * configuration problem instead of an upstream one.
 */
function anidbBlockedMessage(impersonates: boolean): string {
  return impersonates
    ? "anidb blocked by Cloudflare (curl-impersonate was already used)"
    : "anidb blocked by Cloudflare (try curl-impersonate)";
}

/**
 * AniDB answers a maintenance window with a real 200 and an "Under
 * Maintenance" page, so a body check is the only way not to scrape the outage
 * as an empty catalogue.
 */
export function isAnidbMaintenanceText(text: string): boolean {
  return /<title>Under Maintenance<\/title>/i.test(text) || /under maintenance/i.test(text);
}

/**
 * Statuses where a better TLS fingerprint can still change the answer, so the
 * curl fallback is worth a request. Everything else — a missing id, a 5xx
 * outage — is the upstream's real answer, and retrying only doubles the
 * latency before the same result.
 */
function isFingerprintRetryableStatus(status: number): boolean {
  return status === 403 || status === 429;
}

/**
 * Fetches an AniDB page as text, or throws {@link AnidbHttpStatusError}.
 *
 * Every read reports its status. A best-effort mode used to hand the caller
 * whatever body an error carried, so a `503 Under Maintenance` page was scraped
 * for result rows, found none, and reported an outage as "no such anime" —
 * silently, with no health signal for provider fallback. Callers that treat a
 * missing id as a real answer catch the 404 explicitly.
 */
/**
 * The transport choreography now lives in `shared/provider-http-transport`;
 * anidb's policy is the divergent one and stays declared here:
 *
 * - Only 403/429 earn a curl retry — a better fingerprint is the only thing
 *   that can change that answer. A 5xx outage or a real 404 is the upstream's
 *   verdict and re-asking only doubles the latency.
 * - A *relayed* 404 is not anidb.app's verdict: a stale relay answers
 *   `unknown-provider` with a 404 of its own, and reading that as the real
 *   answer once marked the catalogue permanently missing and cached the miss.
 *   Same for relayed 403/429 — the relay's fingerprint may be the thing
 *   Cloudflare refused. Those statuses settle over local curl instead.
 * - A relayed 2xx challenge is also not final — the impersonate fingerprint
 *   can clear what the relay's could not.
 * - The 200-with-"Under Maintenance" page reads as a real 503.
 */
export async function anidbFetchText(
  url: string,
  options: {
    readonly context?: ProviderRuntimeContext;
    readonly signal?: AbortSignal;
    readonly maxTimeSec?: number;
  } = {},
): Promise<string> {
  return providerFetchText(url, {
    context: options.context,
    signal: options.signal,
    providerId: ANIDB_PROVIDER_ID,
    label: "anidb fetch",
    userAgent: ANIDB_USER_AGENT,
    referer: ANIDB_REFERER,
    maxTimeSec: options.maxTimeSec,
    bodyAsStatus: (text) => (isAnidbMaintenanceText(text) ? 503 : null),
    retryStatusViaCurl: isFingerprintRetryableStatus,
    relayedStatusIsFinal: (status) => status !== 404 && !isFingerprintRetryableStatus(status),
    relayedChallengeIsFinal: false,
    statusError: (status) => new AnidbHttpStatusError(status),
    relayedStatusError: (status) => new AnidbHttpStatusError(status),
    blockedError: (impersonated) => new AnidbBlockedError(anidbBlockedMessage(impersonated)),
  });
}

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
  spawnOnce?: SpawnCurlOnce,
): Promise<string> {
  return runProviderCurlWithRetry(args, {
    signal,
    label: "anidb fetch",
    providerId: ANIDB_PROVIDER_ID,
    spawnOnce,
  });
}

export async function searchAnidb(
  query: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnidbSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  // Status reporting is what separates "this title is not on AniDB" from
  // "AniDB is down": a 503 hands back an error page, the browse parser finds
  // no cards, and an origin outage is reported to the user as zero results for
  // their query — and to the release signoff as provider drift. Every read now
  // raises `AnidbHttpStatusError` for status >= 400, so the throw does the work.
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
  const persisted = await context?.cache
    ?.read<{
      malId: number | null;
      anilistId: string | null;
      officialAid: number | null;
      posterUrl: string | null;
    }>(ANIDB_EXTERNAL_IDS_NAMESPACE, showId)
    .catch(() => null);
  if (persisted) {
    externalIdsCache.set(showId, persisted);
    return {
      malId: persisted.malId ?? undefined,
      anilistId: persisted.anilistId ?? undefined,
      officialAid: persisted.officialAid ?? undefined,
      posterUrl: persisted.posterUrl ?? undefined,
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
    const ids = { malId, anilistId, officialAid, posterUrl };
    externalIdsCache.set(showId, ids);
    void context?.cache
      ?.write(ANIDB_EXTERNAL_IDS_NAMESPACE, showId, ids, ANIDB_EXTERNAL_IDS_PERSIST_TTL_MS)
      .catch(() => {});
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
  context?: ProviderRuntimeContext,
): Promise<ReadonlyMap<number, AnimeEpisodeMetadata>> {
  const cacheKey = String(officialAid);
  const cached = officialEpisodeMetadataCache.get(cacheKey);
  if (cached) return new Map(cached);
  const persisted = await context?.cache
    ?.read<ReadonlyArray<[number, AnimeEpisodeMetadata]>>(
      ANIDB_OFFICIAL_EPISODES_NAMESPACE,
      cacheKey,
    )
    .catch(() => null);
  if (persisted?.length) {
    const map = new Map(persisted);
    officialEpisodeMetadataCache.set(cacheKey, map);
    return new Map(map);
  }

  try {
    const response = await providerFetch(
      context,
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
    void context?.cache
      ?.write(
        ANIDB_OFFICIAL_EPISODES_NAMESPACE,
        cacheKey,
        [...metadata],
        ANIDB_OFFICIAL_EPISODES_PERSIST_TTL_MS,
      )
      .catch(() => {});
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
    text = await anidbFetchText(url, { signal, context });
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
    // SAFETY: JSON.parse resolves to the parsed document; the episodes field is shape-checked below.
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
    text = await anidbFetchText(url, { signal, context });
  } catch (error) {
    // No languages row for this episode is a real answer, not a failure.
    if (error instanceof AnidbHttpStatusError && error.status === 404) return [];
    throw error;
  }
  let parsed: { languages?: readonly Record<string, unknown>[] };
  try {
    // SAFETY: JSON.parse resolves to the parsed document; the languages field is shape-checked below.
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
 * Resolves HLS ladder stream links for a single AniDB language embed. When the
 * master host answered with a dead status, `deadHostStatus` carries it so the
 * caller can classify the empty result honestly instead of guessing.
 */
export async function resolveAnidbLanguageStreams(options: {
  readonly context?: ProviderRuntimeContext;
  readonly language: AnidbLanguageEntry;
  readonly audioMode: "sub" | "dub";
  readonly signal?: AbortSignal;
}): Promise<{
  readonly links: readonly AnidbStreamLink[];
  readonly deadHostStatus?: number;
}> {
  const empty = (deadHostStatus?: number) => ({ links: [] as const, deadHostStatus });
  const masterUrl = await fetchAnidbMasterUrl(
    options.language.embedUrl,
    options.signal,
    options.context,
  );
  if (!masterUrl) return empty();

  const inventory = await expandHlsMasterInventory({
    fetch: async (url: string, init?: RequestInit) => {
      try {
        const text = await anidbFetchText(url, {
          signal: (init?.signal instanceof AbortSignal ? init.signal : undefined) ?? options.signal,
          context: options.context,
        });
        return new Response(text, {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      } catch (error) {
        if (error instanceof AnidbHttpStatusError) {
          return new Response(null, { status: error.status });
        }
        throw error;
      }
    },
    masterUrl,
    headers: { "User-Agent": ANIDB_USER_AGENT, Referer: ANIDB_REFERER },
    signal: options.signal,
  });
  // Dead master host → drop the `auto` fallback row that would point mpv at
  // the same dead URL.
  const variants = isHlsDeadHostStatus(inventory.probe.httpStatus) ? [] : inventory.variants;

  return {
    links: variants.map((variant) => ({
      url: variant.url,
      quality: variant.qualityLabel,
      audioMode: options.audioMode,
      referer: ANIDB_REFERER,
      protocol: "hls" as const,
      container: "m3u8" as const,
    })),
    deadHostStatus: isHlsDeadHostStatus(inventory.probe.httpStatus)
      ? inventory.probe.httpStatus
      : undefined,
  };
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
    const resolution = await resolveAnidbLanguageStreams({
      context: options.context,
      language: options.language,
      audioMode: options.mode,
      signal: options.signal,
    });
    if (options.callerSignal?.aborted) throw options.callerSignal.reason;
    const { links, deadHostStatus } = resolution;
    if (links.length > 0) return { mode: options.mode, status: "resolved", links };
    // `not-found`/`provider-unavailable`, not `parse-failed`: an empty link
    // list means the source exposed nothing playable (dead-host drop
    // included) — nothing failed to decode. A gone route is terminal; a 5xx
    // maintenance window may heal, so only it keeps a retry budget.
    const upstreamDown = deadHostStatus !== undefined && deadHostStatus >= 500;
    return {
      mode: options.mode,
      status: "failed",
      links: [],
      failure: {
        code: upstreamDown ? "provider-unavailable" : "not-found",
        message:
          deadHostStatus !== undefined
            ? `AniDB ${options.mode} master host answered HTTP ${deadHostStatus} — dead upstream`
            : `AniDB ${options.mode} source did not expose a playable HLS stream`,
        retryable: upstreamDown,
      },
    };
  } catch (error) {
    if (options.callerSignal?.aborted) throw error;
    // A typed HTTP status (a missing playlist 404s permanently) keeps its own
    // classification — flattening it to retryable network-error would spend a
    // second resolve budget on a dead id.
    const statusError = error instanceof AnidbHttpStatusError ? error : undefined;
    return {
      mode: options.mode,
      status: "failed",
      links: [],
      failure: {
        code: statusError ? httpStatusToResolveErrorCode(statusError.status) : "network-error",
        message: error instanceof Error ? error.message : `AniDB ${options.mode} source failed`,
        retryable: statusError ? httpStatusIsRetryable(statusError.status) : true,
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
