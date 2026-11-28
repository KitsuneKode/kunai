import { createDeadlineSignal, type TimeoutTimers } from "@/infra/abort/timeout-signal";
import {
  createCacheGenerationGate,
  type CacheGenerationToken,
} from "@/infra/concurrency/cache-generation";
import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";
import {
  recordFallbackCatalogAnswer,
  recordPrimaryCatalogAnswer,
} from "@/services/catalog/catalog-source-ledger";
import { observeOnlineIfBound } from "@/services/network/network-observation";
import { classifyNetworkFailure } from "@/services/network/NetworkStatus";
import { VIDEASY_DB_BASE, VIDEASY_DB_BASES } from "@kunai/providers";
import { isJsonObject, type JsonValue } from "@kunai/types";

import {
  classifyTmdbHostError,
  DEFAULT_TMDB_MIRROR_BUDGET,
  type TmdbHost,
  type TmdbMirrorBudgetPolicy,
} from "./tmdb-host-failure";

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
export const LEGACY_PUBLIC_TMDB_API_KEY: string | null = "653bb8af90162bd98fc7ee32bcbbfb3d";

/**
 * Which TMDB credential direct requests use, in order:
 * 1. The user's own key: `KUNAI_TMDB_API_KEY`, else the `tmdbApiKey` setting
 *    (kept in the OS credential vault). Their own quota and terms, and it
 *    sends requests to TMDB itself first — nothing in between depends on Kunai.
 * 2. `KUNAI_BUNDLED_TMDB_API_KEY` — Kunai's key, inlined at release build time
 *    when CI provides `KUNAI_TMDB_BUILD_KEY` (see `RELEASE_DEFINE`).
 * 3. The legacy borrowed key, while it remains shipped.
 *
 * A user key TMDB rejects (401) is set aside for {@link USER_KEY_REJECTED_RETRY_MS}
 * and the shipped key serves meanwhile, so a typo never takes the catalog down.
 */
export interface TmdbApiKeyResolution {
  readonly key: string;
  readonly source: "user" | "kunai" | "legacy" | "none";
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

/**
 * The key Kunai itself ships: the build-time Kunai key, else the legacy key
 * while it remains here. The nullable seam is deliberate: retiring the legacy
 * key is changing the constant above to `null`; the routing below already
 * understands the resulting `none` credential instead of treating an empty key as real.
 */
export function shippedTmdbApiKey(
  legacyKey: string | null = LEGACY_PUBLIC_TMDB_API_KEY,
): TmdbApiKeyResolution {
  const bundled = process.env.KUNAI_BUNDLED_TMDB_API_KEY?.trim();
  if (bundled) return { key: bundled, source: "kunai", kind: classifyTmdbCredential(bundled) };
  const legacy = legacyKey?.trim();
  if (legacy) return { key: legacy, source: "legacy", kind: "api-key" };
  return { key: "", source: "none", kind: "api-key" };
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
/** With a real key (the user's or Kunai's bundled key), TMDB itself is asked first. */
const TMDB_DIRECT_FIRST: readonly TmdbHost[] = [
  TMDB_DIRECT_HOST,
  TMDB_ALT_HOST,
  ...TMDB_PROXY_HOSTS,
];

function tmdbHostOrder(resolveCredential: () => TmdbApiKeyResolution): readonly TmdbHost[] {
  const source = resolveCredential().source;
  return source === "user" || source === "kunai" ? TMDB_DIRECT_FIRST : TMDB_KEYLESS_FIRST;
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
    readonly contentType?: string,
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
 * Keys carry the session generation (see {@link clearTmdbSessionCache}).
 */
const inflightRequests = createKeyedJoiner<JsonValue>({ whenAbandoned: "finish" });
/**
 * Bumped by {@link clearTmdbSessionCache}. A request started under an older
 * generation still answers the callers already waiting on it, but is never
 * joined by a later caller and never writes either cache. Episode and season
 * memory caches in `tmdb.ts` commit through the same gate.
 */
const sessionGate = createCacheGenerationGate();

export function captureTmdbSessionGeneration(): CacheGenerationToken {
  return sessionGate.capture();
}

export function isTmdbSessionCurrent(token: CacheGenerationToken): boolean {
  return sessionGate.isCurrent(token);
}

export function commitTmdbSessionIfFresh(
  token: CacheGenerationToken,
  options: { readonly signal?: AbortSignal; readonly complete?: boolean },
  commit: () => void,
): boolean {
  return sessionGate.commitIfFresh(token, options, commit);
}
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
/**
 * The previous half-open probe chose a direct host and that host failed.
 * The next probe then uses earliest-window order so a recovered mirror can
 * be tried while direct is still down. A successful probe clears it.
 */
let lastHalfOpenDirectProbeFailed = false;

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

/**
 * Clears short-lived TMDB session cache (tests / forced refresh).
 *
 * Requests already in flight are detached, not cancelled: the cache is shared
 * by every surface, so Discover's refresh rejecting them used to cancel an
 * unrelated title-detail season lookup, which read as a missing season and
 * was cached as a complete detail. Detached requests still answer their
 * waiters; later callers start fresh, and a late answer writes nothing.
 */
export function clearTmdbSessionCache(): void {
  sessionCache.clear();
  sessionGate.invalidate();
  hostRetryAfter.clear();
  rateLimitedUntil.clear();
  halfOpenProbeInFlight = false;
  nextHalfOpenProbeAt = 0;
  lastHalfOpenDirectProbeFailed = false;
}

/** How long a host that answered 429 is rested (shorter than an outage breaker). */
const RATE_LIMITED_RETRY_AFTER_MS = 30 * 1000;

/** Errors the walk rethrew as TMDB's own answer. A mirror 403 is not in here. */
const definitiveUpstreamErrors = new WeakSet<Error>();

/** True when the walk rethrew this error as TMDB's own answer, not a dead mirror. */
export function isDefinitiveTmdbAnswer(error: Error): error is TmdbHttpError {
  return error instanceof TmdbHttpError && definitiveUpstreamErrors.has(error);
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

  const generation = sessionGate.capture();
  return inflightRequests.join(
    `${generation.value}:${normalized}`,
    async (upstream) => {
      const durable = isDurableTmdbPath(normalized) ? durableTmdbCache : null;
      let value: JsonValue;
      try {
        value = await fetchTmdbJsonWithFallback(normalized, upstream, timeoutMs);
      } catch (error) {
        // Every host is unreachable: serve the last good answer for this exact
        // request. A definitive 4xx is TMDB's real answer and is never masked.
        const isDefinitive = error instanceof Error && isDefinitiveTmdbAnswer(error);
        const saved = !isDefinitive ? durable?.read(normalized) : null;
        if (saved) {
          if (isSeasonPath(normalized)) recordEpisodesAnswer(true);
          return saved.value;
        }
        throw error;
      }
      // A request cleared mid-flight still answers its waiters, but must not
      // repopulate either cache: the refresh asked for answers fetched after it.
      sessionGate.commitIfFresh(generation, {}, () => {
        sessionCacheWrite(normalized, { expiresAt: now + SESSION_CACHE_MS, value });
        // Only a well-formed answer may replace the last good copy.
        if (durable && isUsableDurableAnswer(normalized, value)) {
          durable.write(normalized, Date.now(), value);
          if (isSeasonPath(normalized)) recordEpisodesAnswer(false);
        }
      });
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

/** Injectable clock and timers so a cold-mirror budget can be tested without sleeping. */
export interface TmdbFetchDependencies {
  readonly now?: () => number;
  readonly timers?: TimeoutTimers<number>;
  readonly budget?: TmdbMirrorBudgetPolicy;
}

async function fetchTmdbHostJson(
  host: TmdbHost,
  normalizedPath: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  resolveCredential: () => TmdbApiKeyResolution,
  timers: TimeoutTimers<number> | undefined,
): Promise<JsonValue> {
  const credential = host.needsApiKey ? resolveCredential() : null;
  const joiner = normalizedPath.includes("?") ? "&" : "?";
  const url =
    credential?.kind === "api-key"
      ? `${host.base}${normalizedPath}${joiner}api_key=${encodeURIComponent(credential.key)}`
      : `${host.base}${normalizedPath}`;
  const headers: Record<string, string> =
    credential?.kind === "bearer" ? { authorization: `Bearer ${credential.key}` } : {};
  return observeOnlineIfBound("search-error", async () => {
    // Never follow a redirect. A keyed request would carry api_key or
    // Authorization to the Location origin (#853). A keyless 3xx is this
    // mirror failing, not a document to chase.
    const deadline = createDeadlineSignal(signal, timeoutMs, { timers });
    try {
      const res = await fetch(url, {
        headers,
        redirect: "manual",
        signal: deadline.signal,
      });
      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? undefined;
        await res.body?.cancel().catch(() => undefined);
        if (res.status === 401 && credential) throw new TmdbCredentialRejectedError(credential);
        throw new TmdbHttpError(res.status, url, contentType);
      }
      const value: JsonValue = JSON.parse(await res.text());
      // Some mirrors answer HTTP 200 with TMDB's error envelope
      // (`{ success: false, status_code, status_message }`). That is this host
      // failing, not TMDB's data: treat it like a 5xx and try the next host.
      if (isJsonObject(value) && value.success === false) {
        throw new Error(`TMDB host returned an error payload (${credentialFreeUrl(url)})`);
      }
      return value;
    } finally {
      deadline.release();
    }
  });
}

function probeHost(
  probeable: readonly TmdbHost[],
  credentialKey: string,
  preferDirect: boolean,
): TmdbHost | undefined {
  const byWindow = [...probeable].sort(
    (left, right) => (hostRetryAfter.get(left.base) ?? 0) - (hostRetryAfter.get(right.base) ?? 0),
  );
  if (preferDirect && credentialKey !== "") {
    const direct = byWindow.find((host) => host.needsApiKey);
    if (direct) return direct;
  }
  return byWindow[0];
}

/**
 * Walks the TMDB host chain. Every host serves the same upstream data, so the
 * only answers worth failing over on are availability failures:
 *
 * - transport error, 5xx, or a keyless mirror's 401/403/HTML 4xx → that host
 *   is broken; mark its breaker and try the next host.
 * - caller abort → not a host failure; rethrow without marking anything.
 * - a keyed 4xx, or a keyless JSON 400/404 → TMDB's own answer; rethrow.
 *
 * Keyless mirrors share a cold-start budget counted only while a mirror
 * attempt is in flight. Direct time does not spend it. Once it is spent the
 * walk skips the remaining mirrors and uses the caller's remaining deadline.
 */
export async function fetchTmdbJsonWithFallback(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  resolveCredential: () => TmdbApiKeyResolution = resolveTmdbApiKey,
  deps: TmdbFetchDependencies = {},
): Promise<JsonValue> {
  const normalized = normalizePath(path);
  const readNow = deps.now ?? Date.now;
  const budget = deps.budget ?? DEFAULT_TMDB_MIRROR_BUDGET;
  const startedAt = readNow();
  const callerDeadline = startedAt + timeoutMs;
  const now = startedAt;
  let mirrorWaitMs = 0;
  let lastError: Error | null = null;

  const hosts = tmdbHostOrder(resolveCredential).filter(
    (host) => !host.needsApiKey || resolveCredential().key !== "",
  );
  const resting = (host: TmdbHost) => now < (rateLimitedUntil.get(host.base) ?? 0);
  const eligible = hosts.filter(
    (host) => now >= (hostRetryAfter.get(host.base) ?? 0) && !resting(host),
  );
  let probing = false;
  let candidates = eligible;
  if (eligible.length === 0) {
    // Half-open: every host is inside its breaker window. One request probes
    // a host; concurrent requests fail fast instead of each sending their own
    // probe. A credential prefers the direct host, unless the previous probe
    // was a direct host that failed; then the earliest window is used so a
    // recovered mirror can answer. A rate-limited host keeps its rest.
    const probeable = hosts.filter((host) => !resting(host));
    if (probeable.length === 0) throw new Error("TMDB hosts rate limited");
    if (halfOpenProbeInFlight) throw new Error("TMDB hosts unavailable (recovery probe in flight)");
    if (now < nextHalfOpenProbeAt)
      throw new Error("TMDB hosts unavailable (next recovery probe pending)");
    const chosen = probeHost(probeable, resolveCredential().key, !lastHalfOpenDirectProbeFailed);
    if (!chosen) throw new Error("no TMDB hosts available");
    probing = true;
    nextHalfOpenProbeAt = readNow() + HALF_OPEN_PROBE_INTERVAL_MS;
    halfOpenProbeInFlight = true;
    candidates = [chosen];
  }

  /** Milliseconds this attempt may wait, or null when a mirror's budget is spent. */
  const attemptTimeout = (host: TmdbHost): number | null => {
    const callerLeft = Math.max(0, callerDeadline - readNow());
    if (host.needsApiKey) return callerLeft;
    const mirrorBudgetLeft = budget.maxTotalMirrorWaitMs - mirrorWaitMs;
    if (mirrorBudgetLeft <= 0) return null;
    return Math.min(budget.perMirrorTimeoutMs, mirrorBudgetLeft, callerLeft);
  };

  /** A credential TMDB refused in this walk; another keyed host would refuse it too. */
  let refusedKey: string | null = null;
  try {
    for (const host of candidates) {
      if (host.needsApiKey && resolveCredential().key === "") continue;
      // Skip a keyed host only while it would send the refused credential. A
      // refused user key is set aside below, so the next keyed host retries
      // with the shipped key instead of being skipped.
      if (host.needsApiKey && refusedKey !== null && resolveCredential().key === refusedKey) {
        continue;
      }
      const timeout = attemptTimeout(host);
      if (timeout === null) continue;
      const countMirrorWait = !host.needsApiKey;
      const mirrorStarted = countMirrorWait ? readNow() : 0;
      try {
        const value = await fetchTmdbHostJson(
          host,
          normalized,
          signal,
          timeout,
          resolveCredential,
          deps.timers,
        );
        if (countMirrorWait) mirrorWaitMs += readNow() - mirrorStarted;
        hostRetryAfter.delete(host.base);
        nextHalfOpenProbeAt = 0;
        lastHalfOpenDirectProbeFailed = false;
        return value;
      } catch (error) {
        if (countMirrorWait) mirrorWaitMs += readNow() - mirrorStarted;
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const kind = classifyTmdbHostError({
          host,
          status: error instanceof TmdbHttpError ? error.status : undefined,
          error: normalizedError,
          signalAborted: signal?.aborted === true,
          contentType: error instanceof TmdbHttpError ? error.contentType : undefined,
        });
        if (kind === "caller-abort") throw normalizedError;
        if (kind === "credential-rejected" && error instanceof TmdbCredentialRejectedError) {
          // The host answered, so its breaker closes. A bad key is not the
          // request's answer: keyless mirrors can still serve it, and a user
          // key is set aside so the shipped key serves until it is fixed.
          hostRetryAfter.delete(host.base);
          nextHalfOpenProbeAt = 0;
          refusedKey = error.credential.key;
          if (error.credential.source === "user") {
            userKeyRejectedValue = error.credential.key;
            userKeyRejectedUntil = readNow() + USER_KEY_REJECTED_RETRY_MS;
          }
          lastError = error;
          continue;
        }
        if (kind === "rate-limited") {
          // Rate limited: a temporary refusal by this host, not TMDB's answer
          // to the request. Rest it briefly and let the next host (or, once
          // every host is out, the saved copy) answer.
          rateLimitedUntil.set(host.base, readNow() + RATE_LIMITED_RETRY_AFTER_MS);
          lastError = normalizedError;
          continue;
        }
        if (kind === "definitive-upstream-4xx") {
          // The host answered: it is reachable, so close its breaker even
          // though this path's answer is a 4xx the caller must see.
          hostRetryAfter.delete(host.base);
          nextHalfOpenProbeAt = 0;
          definitiveUpstreamErrors.add(normalizedError);
          throw normalizedError;
        }
        hostRetryAfter.set(host.base, readNow() + HOST_RETRY_AFTER_MS);
        if (probing) lastHalfOpenDirectProbeFailed = host.needsApiKey;
        lastError = normalizedError;
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
