// One AniList GraphQL client for every read-only CLI surface.
//
// Search, discovery, schedules, title detail, anime metadata and AniSkip id
// lookups used to post to graphql.anilist.co each on their own, and only the
// schedule path understood 429. AniList rate-limits per IP, so rails, search
// and schedule loading at once could trip the limit with no shared backoff.
// Tracker sync (`services/sync/AniListAdapter.ts`) stays separate: it is
// authenticated, mutating, and owns its own retry policy.

import { createKeyedJoiner } from "@/infra/concurrency/keyed-joiner";
import { isJsonObject, type JsonObject, type JsonValue } from "@kunai/types";

export const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const DEFAULT_TIMEOUT_MS = 3_500;
/** Without a usable Retry-After or reset header, back off this long after a 429. */
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;
/** Never honour a server cooldown longer than this; the UI has fallbacks. */
const MAX_COOLDOWN_MS = 120_000;
/** Start cooling down when the remaining budget reaches this. */
const LOW_BUDGET_THRESHOLD = 2;

export type AniListFailureKind = "network" | "timeout" | "rate-limited" | "http" | "unreadable";

/** Every failure from the client, typed so each surface can keep its own policy. */
export class AniListRequestError extends Error {
  constructor(
    readonly kind: AniListFailureKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "AniListRequestError";
  }
}

export type AniListRequest = {
  readonly query: string;
  readonly variables?: Readonly<Record<string, JsonValue>>;
};

export type AniListRequestOptions = {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
};

/**
 * Client-owned monotonic clock for the cooldown: a wall-clock jump backwards
 * must not stretch a one-minute cooldown into an hour.
 */
let clock: () => number = () => performance.now();
/** Monotonic ms until which requests fail fast as rate-limited. */
let cooldownUntil = 0;
/** Bumped by reset; a request started before a reset may not set a cooldown. */
let generation = 0;
/** Identical concurrent requests share one fetch, aborted once nobody waits. */
const inflight = createKeyedJoiner<JsonObject>();

/** Test seam: clear the shared cooldown and in-flight table. */
export function resetAniListClientForTest(): void {
  generation += 1;
  cooldownUntil = 0;
  clock = () => performance.now();
  inflight.clear();
}

/** Test seam: drive the cooldown clock. Pass undefined to restore the real one. */
export function setAniListClockForTest(next: (() => number) | undefined): void {
  clock = next ?? (() => performance.now());
}

/** Remaining cooldown in ms, or 0. Surfaces can show "AniList is busy". */
export function aniListCooldownRemainingMs(): number {
  return Math.max(0, cooldownUntil - clock());
}

/** Seconds, or an HTTP date; anything else (negative, garbage) is ignored. */
function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return undefined;
  const delta = at - Date.now();
  return delta > 0 ? delta : undefined;
}

/** `X-RateLimit-Reset` is an epoch-seconds instant. */
function parseResetInMs(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const delta = Number(value.trim()) * 1000 - Date.now();
  return delta > 0 ? delta : undefined;
}

/** Start (or extend) the cooldown; returns the effective, capped delay. */
function startCooldown(durationMs: number, startedGeneration: number): number {
  const effective = Math.min(Math.max(durationMs, 0), MAX_COOLDOWN_MS);
  if (startedGeneration === generation) {
    cooldownUntil = Math.max(cooldownUntil, clock() + effective);
  }
  return effective;
}

/**
 * Post one GraphQL document and return the parsed body (`{ data, errors }`).
 *
 * - During a rate-limit cooldown, rejects at once without a request, so the
 *   caller reaches its fallback instead of stalling.
 * - Identical concurrent requests with the same deadline share one fetch;
 *   each caller can abandon its wait with its own signal, and the fetch is
 *   aborted once no caller is waiting.
 * - A 200 carrying GraphQL errors, and a 404 carrying the GraphQL envelope
 *   (AniList's answer for a missing `Media`), are returned as answers.
 */
export async function postAniListGraphql(
  request: AniListRequest,
  options: AniListRequestOptions = {},
): Promise<JsonObject> {
  const remaining = aniListCooldownRemainingMs();
  if (remaining > 0) {
    throw new AniListRequestError("rate-limited", "AniList rate limit cooldown", 429, remaining);
  }
  if (options.signal?.aborted) throw abortError(options.signal);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const body = JSON.stringify(request);
  // The deadline is part of the key: a 10 ms caller must not wait out a
  // 100 ms leader, nor a long-budget caller fail at a short leader's deadline.
  const key = `${timeoutMs}|${body}`;
  const startedGeneration = generation;
  return inflight.join(
    key,
    (abandon) => sendAniList(body, timeoutMs, abandon, options.fetchImpl, startedGeneration),
    { signal: options.signal },
  );
}

async function sendAniList(
  body: string,
  timeoutMs: number,
  abandon: AbortSignal,
  fetchImpl: typeof fetch | undefined,
  startedGeneration: number,
): Promise<JsonObject> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const transport = AbortSignal.any([abandon, deadline]);
  const timedOut = () => deadline.aborted && !abandon.aborted;
  let response: Response;
  try {
    response = await (fetchImpl ?? fetch)(ANILIST_GRAPHQL_URL, {
      method: "POST",
      signal: transport,
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
    });
  } catch (cause) {
    const isTimeout = timedOut() || (cause instanceof Error && cause.name === "TimeoutError");
    throw new AniListRequestError(
      isTimeout ? "timeout" : "network",
      isTimeout ? "AniList request timed out" : "AniList request failed",
      undefined,
      undefined,
      { cause },
    );
  }

  if (response.status === 429) {
    const delay = startCooldown(
      parseRetryAfterMs(response.headers.get("retry-after")) ??
        parseResetInMs(response.headers.get("x-ratelimit-reset")) ??
        DEFAULT_RATE_LIMIT_BACKOFF_MS,
      startedGeneration,
    );
    await response.body?.cancel().catch(() => undefined);
    throw new AniListRequestError("rate-limited", "AniList rate limited", 429, delay);
  }

  // Spend the last of the budget gently: stop before the server says 429.
  // Only a header that is present counts (`Number(null)` is 0).
  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  if (remainingHeader !== null && /^\d+$/.test(remainingHeader.trim())) {
    if (Number(remainingHeader) <= LOW_BUDGET_THRESHOLD) {
      startCooldown(
        parseResetInMs(response.headers.get("x-ratelimit-reset")) ??
          DEFAULT_RATE_LIMIT_BACKOFF_MS / 4,
        startedGeneration,
      );
    }
  }

  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    // A body that stalls past the deadline is a timeout, not a bad body.
    if (timedOut()) {
      throw new AniListRequestError(
        "timeout",
        "AniList response timed out",
        response.status,
        undefined,
        { cause },
      );
    }
    throw new AniListRequestError(
      "network",
      "AniList response was cut off",
      response.status,
      undefined,
      { cause },
    );
  }

  let parsed: JsonValue | undefined;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const isEnvelope = isJsonObject(parsed) && ("data" in parsed || "errors" in parsed);
  if (response.status === 404 && isEnvelope && isJsonObject(parsed)) return parsed;
  if (!response.ok) {
    throw new AniListRequestError("http", `AniList HTTP ${response.status}`, response.status);
  }
  if (!isJsonObject(parsed)) {
    throw new AniListRequestError(
      "unreadable",
      "AniList answered with an unreadable body",
      response.status,
    );
  }
  return parsed;
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException("The operation was aborted.", "AbortError");
}
