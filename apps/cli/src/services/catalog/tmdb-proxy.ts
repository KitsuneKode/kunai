import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import {
  recordFallbackCatalogAnswer,
  recordPrimaryCatalogAnswer,
} from "@/services/catalog/catalog-source-ledger";
import { observeOnlineIfBound } from "@/services/network/network-observation";
import { classifyNetworkFailure } from "@/services/network/NetworkStatus";
import { VIDEASY_DB_BASE, VIDEASY_DB_BASES } from "@kunai/providers";
import type { JsonValue } from "@kunai/types";

export { VIDEASY_DB_BASE as TMDB_PROXY_BASE };

export const TMDB_DIRECT_BASE = "https://api.themoviedb.org/3";
/**
 * Official TMDB hostname alias on the same CDN and data. ISP-level DNS
 * interference tends to target `api.themoviedb.org` specifically — measured
 * live: the canonical host resolves to a sinkhole address while this alias
 * still resolves to CloudFront. Same API key, same payloads.
 */
export const TMDB_ALT_BASE = "https://api.tmdb.org/3";
/**
 * Borrowed public TMDB key (the luffy reference project's). It is not Kunai's:
 * its owner can revoke it at any time, which would take direct-TMDB search,
 * trending and recommendations down for every install at once. Kept only as
 * the last resort until a Kunai key is injected at build time.
 */
export const LEGACY_PUBLIC_TMDB_API_KEY = "653bb8af90162bd98fc7ee32bcbbfb3d";
/** @deprecated use {@link resolveTmdbApiKey}; kept for existing imports. */
export const TMDB_API_KEY = LEGACY_PUBLIC_TMDB_API_KEY;

/**
 * Which TMDB key direct requests use, in order:
 * 1. `KUNAI_TMDB_API_KEY` — the user's own key (their own quota and terms).
 * 2. `KUNAI_BUNDLED_TMDB_API_KEY` — Kunai's key, inlined at release build time
 *    when CI provides `KUNAI_TMDB_BUILD_KEY` (see `RELEASE_DEFINE`).
 * 3. The legacy borrowed key.
 */
export interface TmdbApiKeyResolution {
  readonly key: string;
  readonly source: "user" | "kunai" | "legacy";
}

export function resolveTmdbApiKey(
  env: Record<string, string | undefined> = process.env,
): TmdbApiKeyResolution {
  const user = env.KUNAI_TMDB_API_KEY?.trim();
  if (user) return { key: user, source: "user" };
  return shippedTmdbApiKey();
}

/** The key Kunai itself ships: the build-time Kunai key, else the legacy key. */
export function shippedTmdbApiKey(): TmdbApiKeyResolution {
  const bundled = process.env.KUNAI_BUNDLED_TMDB_API_KEY?.trim();
  if (bundled) return { key: bundled, source: "kunai" };
  return { key: LEGACY_PUBLIC_TMDB_API_KEY, source: "legacy" };
}

const DEFAULT_TIMEOUT_MS = 6_000;
const SESSION_CACHE_MS = 2 * 60 * 1_000;
/**
 * After a host fails to answer it is skipped for this long. `api.videasy.to`
 * has gone NXDOMAIN before, and without the breaker every request pays a dead
 * DNS/TCP attempt (up to `timeoutMs`) before the next host in the chain runs.
 * The window is short so a resurrected host resumes without an app restart.
 */
const HOST_RETRY_AFTER_MS = 5 * 60 * 1_000;

type SessionCacheEntry = {
  readonly expiresAt: number;
  readonly value: JsonValue;
};

const SESSION_CACHE_MAX = 500;

type TmdbHost = {
  readonly base: string;
  /** Direct TMDB hosts need the api_key query param; the videasy proxy does not. */
  readonly needsApiKey: boolean;
};

/**
 * Walk order matters: the proxy mirrors are free of the API key and
 * historically primary; the two direct hosts are the same upstream on
 * different DNS names so hostname-targeted interference cannot take out the
 * whole lane.
 */
const TMDB_PROXY_HOSTS: readonly TmdbHost[] = VIDEASY_DB_BASES.map((base) => ({
  base,
  needsApiKey: false,
}));
const TMDB_DIRECT_HOST: TmdbHost = { base: TMDB_DIRECT_BASE, needsApiKey: true };
const TMDB_ALT_HOST: TmdbHost = { base: TMDB_ALT_BASE, needsApiKey: true };

const TMDB_HOSTS: readonly TmdbHost[] = [...TMDB_PROXY_HOSTS, TMDB_DIRECT_HOST, TMDB_ALT_HOST];

/** A host answered with a non-2xx status — the API itself responded. */
export class TmdbHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    // Never the raw URL: direct hosts carry `api_key` in the query, and this
    // message reaches the browse error panel and diagnostics.
    super(`${status} ${credentialFreeUrl(url)}`);
    this.name = "TmdbHttpError";
  }
}

/** Origin and path only: drops the query (api_key, session ids) and userinfo. */
export function credentialFreeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<tmdb request>";
  }
}

const sessionCache = new Map<string, SessionCacheEntry>();
const inflightRequests = new Map<string, Promise<JsonValue>>();
/** Epoch ms until which each host is skipped; absent/0 means eligible. */
const hostRetryAfter = new Map<string, number>();
/** One half-open recovery probe at a time across all request paths. */
let halfOpenProbeInFlight = false;
/**
 * After a failed recovery probe, the next one waits this long. Without it,
 * every request during a long outage paid a full probe timeout before
 * callers could fall back to a saved list.
 */
const HALF_OPEN_PROBE_INTERVAL_MS = 30 * 1000;
let nextHalfOpenProbeAt = 0;

function sessionCacheWrite(key: string, entry: SessionCacheEntry): void {
  // Writes land after async fetches, so insertion order is not age order —
  // evict by earliest expiry, and only when the key is genuinely new.
  if (!sessionCache.has(key) && sessionCache.size >= SESSION_CACHE_MAX) {
    let oldestKey: string | undefined;
    let oldestExpiry = Number.POSITIVE_INFINITY;
    for (const [entryKey, cached] of sessionCache) {
      if (cached.expiresAt < oldestExpiry) {
        oldestExpiry = cached.expiresAt;
        oldestKey = entryKey;
      }
    }
    if (oldestKey !== undefined) sessionCache.delete(oldestKey);
  }
  sessionCache.set(key, entry);
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Durable last-known-good store for series structure (show and season
 * responses). When every TMDB host is down, a series the user has opened
 * before still lists its seasons and episodes — with TMDB's own numbering, so
 * a picked episode, a download or a history write always names the right
 * episode. (A TVmaze fallback was tried and dropped: its numbering differs from
 * TMDB's for real shows, e.g. The Office US S04E05.)
 */
export type TmdbDurableCache = {
  read(path: string): { readonly cachedAt: number; readonly value: JsonValue } | null;
  write(path: string, cachedAt: number, value: JsonValue): void;
};

let durableTmdbCache: TmdbDurableCache | null = null;

/** Installed by the container once the cache DB is open; unbound before it closes. */
export function setTmdbDurableCache(cache: TmdbDurableCache | null): void {
  durableTmdbCache = cache;
}

/** Show details and season listings only: the data episode pickers and schedules need. */
export function isDurableTmdbPath(path: string): boolean {
  return /^\/tv\/\d+(?:\/season\/\d+)?(?:\?[^/]*)?$/.test(path);
}

/** Clears short-lived TMDB session cache (tests / forced refresh). */
export function clearTmdbSessionCache(): void {
  sessionCache.clear();
  inflightRequests.clear();
  hostRetryAfter.clear();
  halfOpenProbeInFlight = false;
  nextHalfOpenProbeAt = 0;
}

/**
 * A follower may opt out of waiting without cancelling the leader fetch — the
 * shared TMDB task must not inherit a superseded type-ahead abort signal.
 */
function joinTmdbInflight(task: Promise<JsonValue>, signal?: AbortSignal): Promise<JsonValue> {
  if (!signal) return task;
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("The operation was aborted.", "AbortError"),
    );
  }
  return new Promise<JsonValue>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort);
    void task.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
        return undefined;
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
        return undefined;
      },
    );
  });
}

/**
 * Proxy + mirror chain with in-flight dedup and a short session cache so
 * trending/recommendations/search do not repeat identical TMDB calls.
 */
export async function fetchTmdbJsonCached(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<JsonValue> {
  const normalized = normalizePath(path);
  const now = Date.now();
  const cached = sessionCache.get(normalized);
  if (cached && cached.expiresAt > now) return cached.value;

  let task = inflightRequests.get(normalized);
  if (!task) {
    const durable = isDurableTmdbPath(normalized) ? durableTmdbCache : null;
    task = fetchTmdbJsonWithFallback(normalized, undefined, timeoutMs)
      .then((value) => {
        sessionCacheWrite(normalized, { expiresAt: now + SESSION_CACHE_MS, value });
        inflightRequests.delete(normalized);
        if (durable) {
          durable.write(normalized, Date.now(), value);
          recordEpisodesAnswer(false);
        }
        return value;
      })
      .catch((error: Error) => {
        inflightRequests.delete(normalized);
        // Every host is unreachable: serve the last good answer for this exact
        // request. A definitive 4xx is TMDB's real answer and is never masked.
        const isDefinitive = error instanceof TmdbHttpError && error.status < 500;
        const saved = !isDefinitive ? durable?.read(normalized) : null;
        if (saved) {
          recordEpisodesAnswer(true);
          return saved.value;
        }
        throw error;
      });
    inflightRequests.set(normalized, task);
  }

  return joinTmdbInflight(task, signal);
}

function recordEpisodesAnswer(fromSaved: boolean): void {
  if (fromSaved) {
    recordFallbackCatalogAnswer(
      {
        capability: "series-episodes",
        lane: "movie-series",
        sourceId: "saved",
        sourceName: "saved TMDB copy",
      },
      "TMDB unreachable",
    );
    return;
  }
  recordPrimaryCatalogAnswer({
    capability: "series-episodes",
    lane: "movie-series",
    sourceId: "tmdb",
    sourceName: "TMDB",
  });
}

async function fetchTmdbHostJson(
  host: TmdbHost,
  normalizedPath: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<JsonValue> {
  const joiner = host.needsApiKey ? (normalizedPath.includes("?") ? "&" : "?") : "";
  const url = host.needsApiKey
    ? `${host.base}${normalizedPath}${joiner}api_key=${encodeURIComponent(resolveTmdbApiKey().key)}`
    : `${host.base}${normalizedPath}`;
  return observeOnlineIfBound("search-error", async () => {
    const res = await fetch(url, { signal: withTimeoutSignal(signal, timeoutMs) });
    if (!res.ok) throw new TmdbHttpError(res.status, url);
    // SAFETY: Response.json() resolves to the parsed JSON document.
    return res.json() as Promise<JsonValue>;
  });
}

/**
 * Walks the TMDB host chain. Every host serves the same upstream data, so the
 * only answers worth failing over on are availability failures:
 *
 * - transport error or 5xx → the host is unreachable or broken; mark its
 *   breaker and try the next host.
 * - caller abort → not a host failure; rethrow without marking anything.
 * - 4xx → a definitive upstream answer identical on every host; rethrow so
 *   callers see the real status instead of paying every host for one 404.
 */
export async function fetchTmdbJsonWithFallback(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<JsonValue> {
  const normalized = normalizePath(path);
  const now = Date.now();
  let lastError: Error | null = null;

  const eligible = TMDB_HOSTS.filter((host) => now >= (hostRetryAfter.get(host.base) ?? 0));
  let probing = false;
  let candidates = eligible;
  if (eligible.length === 0) {
    // Half-open: every host is inside its breaker window. One request probes
    // the host whose window ends first; concurrent requests fail fast instead
    // of each sending their own probe (20 distinct paths = 20 probes before).
    if (halfOpenProbeInFlight) throw new Error("TMDB hosts unavailable (recovery probe in flight)");
    if (now < nextHalfOpenProbeAt)
      throw new Error("TMDB hosts unavailable (next recovery probe pending)");
    probing = true;
    nextHalfOpenProbeAt = now + HALF_OPEN_PROBE_INTERVAL_MS;
    halfOpenProbeInFlight = true;
    candidates = [...TMDB_HOSTS]
      .sort((a, b) => (hostRetryAfter.get(a.base) ?? 0) - (hostRetryAfter.get(b.base) ?? 0))
      .slice(0, 1);
  }

  try {
    for (const host of candidates) {
      try {
        const value = await fetchTmdbHostJson(host, normalized, signal, timeoutMs);
        hostRetryAfter.delete(host.base);
        nextHalfOpenProbeAt = 0;
        return value;
      } catch (error) {
        if (signal?.aborted === true) throw error;
        if (error instanceof TmdbHttpError && error.status < 500) {
          // The host answered: it is reachable, so close its breaker even
          // though this path's answer is a 4xx the caller must see.
          hostRetryAfter.delete(host.base);
          nextHalfOpenProbeAt = 0;
          throw error;
        }
        hostRetryAfter.set(host.base, Date.now() + HOST_RETRY_AFTER_MS);
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  } finally {
    if (probing) halfOpenProbeInFlight = false;
  }
  throw lastError ?? new Error("no TMDB hosts available");
}

export function isTmdbNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    name.includes("failedtoopensocket") ||
    message.includes("network") ||
    classifyNetworkFailure(message) !== "unknown"
  );
}

export function formatTmdbSearchError(error: unknown): Error {
  if (error instanceof Error && isTmdbNetworkError(error)) {
    return new Error("Search service unreachable");
  }
  if (error instanceof Error) return error;
  return new Error("Search failed");
}
