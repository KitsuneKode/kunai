import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import { observeOnlineIfBound } from "@/services/network/network-observation";
import { classifyNetworkFailure } from "@/services/network/NetworkStatus";
import { VIDEASY_DB_BASE, VIDEASY_DB_BASES } from "@kunai/providers";
import type { JsonValue } from "@kunai/types";

export { VIDEASY_DB_BASE as TMDB_PROXY_BASE };

export const TMDB_DIRECT_BASE = "https://api.themoviedb.org/3";
/** Public TMDB API key (same as used in the luffy reference project). */
export const TMDB_API_KEY = "653bb8af90162bd98fc7ee32bcbbfb3d";

const DEFAULT_TIMEOUT_MS = 6_000;
const SESSION_CACHE_MS = 2 * 60 * 1_000;
/**
 * After the proxy fails once it is skipped for this long. `api.videasy.to`
 * has gone NXDOMAIN before, and without the breaker every request pays a dead
 * DNS/TCP attempt (up to `timeoutMs`) before the direct fallback runs. The
 * window is short so a resurrected proxy resumes without an app restart.
 */
const PROXY_RETRY_AFTER_MS = 5 * 60 * 1_000;

type SessionCacheEntry = {
  readonly expiresAt: number;
  readonly value: JsonValue;
};

const SESSION_CACHE_MAX = 500;
const sessionCache = new Map<string, SessionCacheEntry>();
const inflightRequests = new Map<string, Promise<JsonValue>>();
/** Epoch ms until which the proxy is skipped; `0` means eligible. */
let proxyRetryAfter = 0;

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
  proxyRetryAfter = 0;
}

/**
 * Proxy + direct fallback with in-flight dedup and a short session cache so
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
  for (const base of VIDEASY_DB_BASES) {
    const url = `${base}${normalized}`;
    try {
      return await observeOnlineIfBound("search-error", async () => {
        const res = await fetch(url, { signal: withTimeoutSignal(signal, timeoutMs) });
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        // SAFETY: Response.json() resolves to the parsed JSON document.
        return res.json() as Promise<JsonValue>;
      });
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
  const normalized = normalizePath(path);
  const joiner = normalized.includes("?") ? "&" : "?";
  const directUrl = `${TMDB_DIRECT_BASE}${normalized}${joiner}api_key=${TMDB_API_KEY}`;
  return observeOnlineIfBound("search-error", async () => {
    const res = await fetch(directUrl, { signal: withTimeoutSignal(signal, timeoutMs) });
    if (!res.ok) throw new Error(`${res.status} ${directUrl}`);
    // SAFETY: Response.json() resolves to the parsed JSON document.
    return res.json() as Promise<JsonValue>;
  });
}

export async function fetchTmdbJsonWithFallback(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<JsonValue> {
  const normalized = normalizePath(path);
  if (Date.now() < proxyRetryAfter) {
    return fetchTmdbDirectJson(normalized, signal, timeoutMs);
  }
  try {
    return await fetchTmdbProxyJson(normalized, signal, timeoutMs);
  } catch (error) {
    // An abort is the caller's decision, not a proxy failure — do not trip the
    // breaker, and do not spend another request the caller already cancelled.
    if (signal?.aborted === true) throw error;
    proxyRetryAfter = Date.now() + PROXY_RETRY_AFTER_MS;
    return fetchTmdbDirectJson(normalized, signal, timeoutMs);
  }
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

export function formatTmdbSearchError(error: unknown): Error {
  if (error instanceof Error && isTmdbNetworkError(error)) {
    return new Error("Search service unreachable");
  }
  if (error instanceof Error) return error;
  return new Error("Search failed");
}
