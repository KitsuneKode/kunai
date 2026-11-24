import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";
import {
  recordFallbackCatalogAnswer,
  recordPrimaryCatalogAnswer,
} from "@/services/catalog/catalog-source-ledger";
import { observeOnlineIfBound } from "@/services/network/network-observation";
import { classifyNetworkFailure } from "@/services/network/NetworkStatus";
import { VIDEASY_DB_BASE, VIDEASY_DB_BASES } from "@kunai/providers";
import { isJsonObject, type JsonValue } from "@kunai/types";

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
 * Which TMDB credential direct requests use, in order:
 * 1. The user's own key: `KUNAI_TMDB_API_KEY`, else the `tmdbApiKey` setting
 *    (kept in the OS credential vault). Their own quota and terms, and it
 *    sends requests to TMDB itself first — nothing in between depends on Kunai.
 * 2. `KUNAI_BUNDLED_TMDB_API_KEY` — Kunai's key, inlined at release build time
 *    when CI provides `KUNAI_TMDB_BUILD_KEY` (see `RELEASE_DEFINE`).
 * 3. The legacy borrowed key.
 *
 * A user key TMDB rejects (401) is set aside for {@link USER_KEY_REJECTED_RETRY_MS}
 * and the shipped key serves meanwhile, so a typo never takes the catalog down.
 */
export interface TmdbApiKeyResolution {
  readonly key: string;
  readonly source: "user" | "kunai" | "legacy";
  /** v3 keys ride in the `api_key` query; v4 read tokens in `Authorization`. */
  readonly kind: TmdbCredentialKind;
  /** Where a user key came from. */
  readonly origin?: "env" | "settings";
}

export type TmdbCredentialKind = "api-key" | "bearer";

/** How long a user key TMDB rejected is set aside before it is tried again. */
export const USER_KEY_REJECTED_RETRY_MS = 10 * 60 * 1000;

let configuredUserKey: () => string = () => "";
let userKeyRejectedUntil = 0;
let userKeyRejectedValue = "";

/** Installed by the container: reads the `tmdbApiKey` setting live. */
export function setTmdbUserKeySource(read: (() => string) | null): void {
  configuredUserKey = read ?? (() => "");
  userKeyRejectedUntil = 0;
  userKeyRejectedValue = "";
}

/** v4 read access tokens are JWTs; everything else is sent as a v3 key. */
export function classifyTmdbCredential(value: string): TmdbCredentialKind {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value) ? "bearer" : "api-key";
}

/** Whether a pasted value looks like a TMDB credential at all. */
export function isPlausibleTmdbCredential(value: string): boolean {
  const trimmed = value.trim();
  return /^[0-9a-f]{32}$/i.test(trimmed) || classifyTmdbCredential(trimmed) === "bearer";
}

export function resolveTmdbApiKey(
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now(),
): TmdbApiKeyResolution {
  const fromEnv = env.KUNAI_TMDB_API_KEY?.trim();
  const fromSettings = configuredUserKey().trim();
  const user = fromEnv || fromSettings;
  const rejected = user !== "" && user === userKeyRejectedValue && now < userKeyRejectedUntil;
  if (user && !rejected) {
    return {
      key: user,
      source: "user",
      kind: classifyTmdbCredential(user),
      origin: fromEnv ? "env" : "settings",
    };
  }
  return shippedTmdbApiKey();
}

/** The key Kunai itself ships: the build-time Kunai key, else the legacy key. */
export function shippedTmdbApiKey(): TmdbApiKeyResolution {
  const bundled = process.env.KUNAI_BUNDLED_TMDB_API_KEY?.trim();
  if (bundled) return { key: bundled, source: "kunai", kind: classifyTmdbCredential(bundled) };
  return { key: LEGACY_PUBLIC_TMDB_API_KEY, source: "legacy", kind: "api-key" };
}

/** What /diagnostics shows about the TMDB credential. */
export interface TmdbCredentialStatus {
  readonly active: TmdbApiKeyResolution;
  /** True while a configured user key is set aside after TMDB rejected it. */
  readonly userKeyRejected: boolean;
}

export function tmdbCredentialStatus(now: number = Date.now()): TmdbCredentialStatus {
  const user = (process.env.KUNAI_TMDB_API_KEY?.trim() || configuredUserKey().trim()) ?? "";
  return {
    active: resolveTmdbApiKey(process.env, now),
    userKeyRejected: user !== "" && user === userKeyRejectedValue && now < userKeyRejectedUntil,
  };
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

const TMDB_KEYLESS_FIRST: readonly TmdbHost[] = [
  ...TMDB_PROXY_HOSTS,
  TMDB_DIRECT_HOST,
  TMDB_ALT_HOST,
];
/** With the user's own key, TMDB itself is asked first; mirrors are the fallback. */
const TMDB_DIRECT_FIRST: readonly TmdbHost[] = [
  TMDB_DIRECT_HOST,
  TMDB_ALT_HOST,
  ...TMDB_PROXY_HOSTS,
];

function tmdbHostOrder(): readonly TmdbHost[] {
  return resolveTmdbApiKey().source === "user" ? TMDB_DIRECT_FIRST : TMDB_KEYLESS_FIRST;
}

/** A keyed host answered 401: the credential, not the request, was refused. */
class TmdbCredentialRejectedError extends Error {
  constructor(readonly credential: TmdbApiKeyResolution) {
    super("TMDB rejected the API key");
    this.name = "TmdbCredentialRejectedError";
  }
}

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
/**
 * "finish": a follower may opt out of waiting without cancelling the shared
 * fetch — a superseded type-ahead request still warms the session cache.
 */
const inflightRequests = createKeyedJoiner<JsonValue>({ whenAbandoned: "finish" });
/** Epoch ms until which each host is skipped; absent/0 means eligible. */
const hostRetryAfter = new Map<string, number>();
/**
 * Hosts resting after a 429. Kept apart from the outage breaker: a rate
 * limit is not cleared by a recovery probe, so a rested host is neither
 * walked nor probed until its rest ends.
 */
const rateLimitedUntil = new Map<string, number>();
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
  rateLimitedUntil.clear();
  halfOpenProbeInFlight = false;
  nextHalfOpenProbeAt = 0;
}

/** How long a host that answered 429 is rested (shorter than an outage breaker). */
const RATE_LIMITED_RETRY_AFTER_MS = 30 * 1000;

/** A 4xx other than 429: TMDB's real answer, identical on every host. */
function isDefinitiveTmdbStatus(status: number): boolean {
  return status < 500 && status !== 429;
}

/** The shape a show or season answer must have before it may be kept as last-known-good. */
function isUsableDurableAnswer(path: string, value: JsonValue): boolean {
  if (!isJsonObject(value)) return false;
  return /\/season\/\d+/.test(path) ? Array.isArray(value.episodes) : Array.isArray(value.seasons);
}

function abortReasonOf(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
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
  // A caller that already left must not start a request nobody will read.
  if (signal?.aborted) throw abortReasonOf(signal);

  return inflightRequests.join(
    normalized,
    async (upstream) => {
      const durable = isDurableTmdbPath(normalized) ? durableTmdbCache : null;
      let value: JsonValue;
      try {
        value = await fetchTmdbJsonWithFallback(normalized, upstream, timeoutMs);
      } catch (error) {
        // A cleared request answers nobody: no saved-copy fallback either.
        if (upstream.aborted) throw error;
        // Every host is unreachable: serve the last good answer for this exact
        // request. A definitive 4xx is TMDB's real answer and is never masked.
        const isDefinitive = error instanceof TmdbHttpError && isDefinitiveTmdbStatus(error.status);
        const saved = !isDefinitive ? durable?.read(normalized) : null;
        if (saved) {
          if (isSeasonPath(normalized)) recordEpisodesAnswer(true);
          return saved.value;
        }
        throw error;
      }
      // A request cleared mid-flight must not repopulate either cache.
      if (upstream.aborted) return value;
      sessionCacheWrite(normalized, { expiresAt: now + SESSION_CACHE_MS, value });
      // Only a well-formed answer may replace the last good copy.
      if (durable && isUsableDurableAnswer(normalized, value)) {
        durable.write(normalized, Date.now(), value);
        if (isSeasonPath(normalized)) recordEpisodesAnswer(false);
      }
      return value;
    },
    { signal },
  );
}

/**
 * A season request is an episode list. A bare show request (`/tv/:id`) also
 * serves metadata (genres for recommendations), so it does not speak for the
 * episode source.
 */
function isSeasonPath(path: string): boolean {
  return /^\/tv\/\d+\/season\/\d+(?:\?|$)/.test(path);
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
  const credential = host.needsApiKey ? resolveTmdbApiKey() : null;
  const joiner = normalizedPath.includes("?") ? "&" : "?";
  const url =
    credential?.kind === "api-key"
      ? `${host.base}${normalizedPath}${joiner}api_key=${encodeURIComponent(credential.key)}`
      : `${host.base}${normalizedPath}`;
  const headers: Record<string, string> =
    credential?.kind === "bearer" ? { authorization: `Bearer ${credential.key}` } : {};
  return observeOnlineIfBound("search-error", async () => {
    const res = await fetch(url, { headers, signal: withTimeoutSignal(signal, timeoutMs) });
    if (res.status === 401 && credential) {
      await res.body?.cancel().catch(() => undefined);
      throw new TmdbCredentialRejectedError(credential);
    }
    if (!res.ok) throw new TmdbHttpError(res.status, url);
    const value: JsonValue = JSON.parse(await res.text());
    // Some mirrors answer HTTP 200 with TMDB's error envelope
    // (`{ success: false, status_code, status_message }`). That is this host
    // failing, not TMDB's data: treat it like a 5xx and try the next host.
    if (isJsonObject(value) && value.success === false) {
      throw new Error(`TMDB host returned an error payload (${credentialFreeUrl(url)})`);
    }
    return value;
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

  const hosts = tmdbHostOrder();
  const resting = (host: TmdbHost) => now < (rateLimitedUntil.get(host.base) ?? 0);
  const eligible = hosts.filter(
    (host) => now >= (hostRetryAfter.get(host.base) ?? 0) && !resting(host),
  );
  let probing = false;
  let candidates = eligible;
  if (eligible.length === 0) {
    // Half-open: every host is inside its breaker window. One request probes
    // the host whose window ends first; concurrent requests fail fast instead
    // of each sending their own probe (20 distinct paths = 20 probes before).
    // Only an outage is probed early; a rate-limited host keeps its rest.
    const probeable = hosts.filter((host) => !resting(host));
    if (probeable.length === 0) throw new Error("TMDB hosts rate limited");
    if (halfOpenProbeInFlight) throw new Error("TMDB hosts unavailable (recovery probe in flight)");
    if (now < nextHalfOpenProbeAt)
      throw new Error("TMDB hosts unavailable (next recovery probe pending)");
    probing = true;
    nextHalfOpenProbeAt = now + HALF_OPEN_PROBE_INTERVAL_MS;
    halfOpenProbeInFlight = true;
    candidates = [...probeable]
      .sort((a, b) => (hostRetryAfter.get(a.base) ?? 0) - (hostRetryAfter.get(b.base) ?? 0))
      .slice(0, 1);
  }

  /** A credential TMDB refused in this walk; another keyed host would refuse it too. */
  let refusedKey: string | null = null;
  try {
    for (const host of candidates) {
      // Skip a keyed host only while it would send the refused credential. A
      // refused user key is set aside below, so the next keyed host retries
      // with the shipped key instead of being skipped.
      if (host.needsApiKey && refusedKey !== null && resolveTmdbApiKey().key === refusedKey) {
        continue;
      }
      try {
        const value = await fetchTmdbHostJson(host, normalized, signal, timeoutMs);
        hostRetryAfter.delete(host.base);
        nextHalfOpenProbeAt = 0;
        return value;
      } catch (error) {
        if (signal?.aborted === true) throw error;
        if (error instanceof TmdbCredentialRejectedError) {
          // The host answered, so its breaker closes. A bad key is not the
          // request's answer: keyless mirrors can still serve it, and a user
          // key is set aside so the shipped key serves until it is fixed.
          hostRetryAfter.delete(host.base);
          nextHalfOpenProbeAt = 0;
          refusedKey = error.credential.key;
          if (error.credential.source === "user") {
            userKeyRejectedValue = error.credential.key;
            userKeyRejectedUntil = Date.now() + USER_KEY_REJECTED_RETRY_MS;
          }
          lastError = error;
          continue;
        }
        if (error instanceof TmdbHttpError && error.status === 429) {
          // Rate limited: a temporary refusal by this host, not TMDB's answer
          // to the request. Rest it briefly and let the next host (or, once
          // every host is out, the saved copy) answer.
          rateLimitedUntil.set(host.base, Date.now() + RATE_LIMITED_RETRY_AFTER_MS);
          lastError = error;
          continue;
        }
        if (error instanceof TmdbHttpError && isDefinitiveTmdbStatus(error.status)) {
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
