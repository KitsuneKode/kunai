import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
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
/** Public TMDB API key (same as used in the luffy reference project). */
export const TMDB_API_KEY = "653bb8af90162bd98fc7ee32bcbbfb3d";

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
    super(`${status} ${url}`);
    this.name = "TmdbHttpError";
  }
}

const sessionCache = new Map<string, SessionCacheEntry>();
const inflightRequests = new Map<string, Promise<JsonValue>>();
/** Epoch ms until which each host is skipped; absent/0 means eligible. */
const hostRetryAfter = new Map<string, number>();

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

/** Clears short-lived TMDB session cache (tests / forced refresh). */
export function clearTmdbSessionCache(): void {
  sessionCache.clear();
  inflightRequests.clear();
  hostRetryAfter.clear();
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

  const inflight = inflightRequests.get(normalized);
  if (inflight) return inflight;

  const task = fetchTmdbJsonWithFallback(normalized, signal, timeoutMs)
    .then((value) => {
      sessionCacheWrite(normalized, { expiresAt: now + SESSION_CACHE_MS, value });
      inflightRequests.delete(normalized);
      return value;
    })
    .catch((error) => {
      inflightRequests.delete(normalized);
      throw error;
    });

  inflightRequests.set(normalized, task);
  return task;
}

export async function fetchTmdbProxyJson(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<JsonValue> {
  const normalized = normalizePath(path);
  let lastError: unknown;
  // Mirror chain: api.videasy.to went NXDOMAIN while db.wingsdatabase.com
  // serves the same /3 contract — walk the live-first list so one dead host
  // never burns the whole proxy leg.
  for (const host of TMDB_PROXY_HOSTS) {
    try {
      return await fetchTmdbHostJson(host, normalized, signal, timeoutMs);
    } catch (error) {
      // A caller abort stops the chain; a per-request timeout still earns the
      // next mirror its attempt.
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export async function fetchTmdbDirectJson(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<JsonValue> {
  return fetchTmdbHostJson(TMDB_DIRECT_HOST, normalizePath(path), signal, timeoutMs);
}

async function fetchTmdbHostJson(
  host: TmdbHost,
  normalizedPath: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<JsonValue> {
  const joiner = host.needsApiKey ? (normalizedPath.includes("?") ? "&" : "?") : "";
  const url = host.needsApiKey
    ? `${host.base}${normalizedPath}${joiner}api_key=${TMDB_API_KEY}`
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

  for (const host of TMDB_HOSTS) {
    if (now < (hostRetryAfter.get(host.base) ?? 0)) continue;
    try {
      return await fetchTmdbHostJson(host, normalized, signal, timeoutMs);
    } catch (error) {
      if (signal?.aborted === true) throw error;
      if (error instanceof TmdbHttpError && error.status < 500) throw error;
      hostRetryAfter.set(host.base, Date.now() + HOST_RETRY_AFTER_MS);
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("no TMDB hosts available");
}

export function isTmdbNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    name.includes("failedtoopensocket") ||
    name.includes("aborterror") ||
    message.includes("network") ||
    classifyNetworkFailure(message) !== "unknown"
  );
}

/**
 * Why a TMDB read produced no usable data. Callers used to get `null` for all
 * of these alike and answer "check your connection" even when the catalog had
 * answered — this is the vocabulary that keeps those stories apart.
 */
export type TmdbFetchFailureKind =
  /** No host answered at all: DNS, socket, timeout — a connectivity problem. */
  | "unreachable"
  /** A host answered with an error status other than 404 (rate limit, 5xx). */
  | "upstream"
  /** The upstream says no such record exists — a definitive answer, not a failure. */
  | "not-found"
  /** A host answered, but the body could not be parsed as JSON. */
  | "malformed"
  /** Something else threw — report it without guessing at a cause. */
  | "unknown";

/** A 4xx answer is definitive: the upstream says the resource is not there. */
export function isTmdbClientError(error: unknown): boolean {
  return error instanceof TmdbHttpError && error.status >= 400 && error.status < 500;
}

export function classifyTmdbFetchFailure(error: unknown): TmdbFetchFailureKind {
  if (error instanceof TmdbHttpError) {
    return error.status === 404 ? "not-found" : "upstream";
  }
  // `res.json()` rejects with SyntaxError on a non-JSON body; that is the
  // upstream answering something we cannot read, not a dead connection.
  if (error instanceof SyntaxError) return "malformed";
  // Thrown by fetchTmdbJsonWithFallback when every host is inside its breaker
  // window — each skip was earned by a transport or 5xx failure, so the honest
  // residue is "unreachable".
  if (error instanceof Error && error.message === "no TMDB hosts available") {
    return "unreachable";
  }
  if (isTmdbNetworkError(error)) return "unreachable";
  return "unknown";
}

export function formatTmdbSearchError(error: unknown): Error {
  if (error instanceof Error && isTmdbNetworkError(error)) {
    return new Error("Search service unreachable");
  }
  if (error instanceof Error) return error;
  return new Error("Search failed");
}
