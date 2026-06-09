import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import { VIDEASY_DB_BASE } from "@kunai/providers";

export { VIDEASY_DB_BASE as TMDB_PROXY_BASE };

export const TMDB_DIRECT_BASE = "https://api.themoviedb.org/3";
/** Public TMDB API key (same as used in the luffy reference project). */
export const TMDB_API_KEY = "653bb8af90162bd98fc7ee32bcbbfb3d";

const DEFAULT_TIMEOUT_MS = 6_000;
const SESSION_CACHE_MS = 2 * 60 * 1_000;

type SessionCacheEntry = {
  readonly expiresAt: number;
  readonly value: unknown;
};

const sessionCache = new Map<string, SessionCacheEntry>();
const inflightRequests = new Map<string, Promise<unknown>>();

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** Clears short-lived TMDB session cache (tests / forced refresh). */
export function clearTmdbSessionCache(): void {
  sessionCache.clear();
  inflightRequests.clear();
}

/**
 * Proxy + direct fallback with in-flight dedup and a short session cache so
 * trending/recommendations/search do not repeat identical TMDB calls.
 */
export async function fetchTmdbJsonCached(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const normalized = normalizePath(path);
  const now = Date.now();
  const cached = sessionCache.get(normalized);
  if (cached && cached.expiresAt > now) return cached.value;

  const inflight = inflightRequests.get(normalized);
  if (inflight) return inflight;

  const task = fetchTmdbJsonWithFallback(normalized, signal, timeoutMs)
    .then((value) => {
      sessionCache.set(normalized, { expiresAt: now + SESSION_CACHE_MS, value });
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
): Promise<unknown> {
  const normalized = normalizePath(path);
  const url = `${VIDEASY_DB_BASE}${normalized}`;
  const res = await fetch(url, { signal: withTimeoutSignal(signal, timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export async function fetchTmdbJsonWithFallback(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const normalized = normalizePath(path);
  try {
    return await fetchTmdbProxyJson(normalized, signal, timeoutMs);
  } catch {
    const joiner = normalized.includes("?") ? "&" : "?";
    const directUrl = `${TMDB_DIRECT_BASE}${normalized}${joiner}api_key=${TMDB_API_KEY}`;
    const res = await fetch(directUrl, { signal: withTimeoutSignal(signal, timeoutMs) });
    if (!res.ok) throw new Error(`${res.status} ${directUrl}`);
    return res.json();
  }
}

export function isTmdbNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    name.includes("failedtoopensocket") ||
    name.includes("aborterror") ||
    message.includes("failedtoopensocket") ||
    message.includes("econnrefused") ||
    message.includes("network") ||
    message.includes("unreachable") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("was there a typo in the url or port")
  );
}

export function formatTmdbSearchError(error: unknown): Error {
  if (error instanceof Error && isTmdbNetworkError(error)) {
    return new Error("Search service unreachable");
  }
  if (error instanceof Error) return error;
  return new Error("Search failed");
}
