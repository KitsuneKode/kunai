// One AniList GraphQL client for every read-only CLI surface.
//
// Search, discovery, schedules, title detail, anime metadata and AniSkip id
// lookups used to post to graphql.anilist.co each on their own, and only the
// schedule path understood 429. AniList rate-limits per IP, so rails, search
// and schedule loading at once could trip the limit with no shared backoff.
// Tracker sync (`services/sync/AniListAdapter.ts`) stays separate: it is
// authenticated, mutating, and owns its own retry policy.

import { withTimeoutSignal } from "@/infra/abort/timeout-signal";
import { isJsonObject, type JsonObject, type JsonValue } from "@kunai/types";

export const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const DEFAULT_TIMEOUT_MS = 3_500;
/** Without a usable Retry-After, back off this long after a 429. */
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
  readonly now?: () => number;
};

/** Epoch ms until which requests fail fast as rate-limited. */
let cooldownUntil = 0;
const inflight = new Map<string, Promise<JsonObject>>();

/** Test seam: clear the shared cooldown and in-flight table. */
export function resetAniListClientForTest(): void {
  cooldownUntil = 0;
  inflight.clear();
}

/** Remaining cooldown in ms, or 0. Surfaces can show "AniList is busy". */
export function aniListCooldownRemainingMs(now: number = Date.now()): number {
  return Math.max(0, cooldownUntil - now);
}

function parseRetryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function startCooldown(durationMs: number, now: number): void {
  cooldownUntil = Math.max(cooldownUntil, now + Math.min(durationMs, MAX_COOLDOWN_MS));
}

/**
 * Post one GraphQL document and return the parsed body (`{ data, errors }`).
 *
 * - During a rate-limit cooldown, rejects at once without a request, so the
 *   caller reaches its fallback instead of stalling.
 * - Identical concurrent requests share one fetch. The shared fetch is bounded
 *   by its own timeout; each caller can abandon its wait with its own signal.
 * - A 200 carrying GraphQL errors is returned as-is: callers read `data`.
 */
export async function postAniListGraphql(
  request: AniListRequest,
  options: AniListRequestOptions = {},
): Promise<JsonObject> {
  const now = options.now?.() ?? Date.now();
  if (now < cooldownUntil) {
    throw new AniListRequestError(
      "rate-limited",
      "AniList rate limit cooldown",
      429,
      cooldownUntil - now,
    );
  }
  if (options.signal?.aborted) throw abortError(options.signal);

  const body = JSON.stringify(request);
  let task = inflight.get(body);
  if (!task) {
    task = sendAniList(body, options).finally(() => {
      if (inflight.get(body) === task) inflight.delete(body);
    });
    inflight.set(body, task);
  }
  return joinWithSignal(task, options.signal);
}

async function sendAniList(body: string, options: AniListRequestOptions): Promise<JsonObject> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetchImpl(ANILIST_GRAPHQL_URL, {
      method: "POST",
      signal: withTimeoutSignal(undefined, timeoutMs),
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
    });
  } catch (cause) {
    const timedOut =
      cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
    throw new AniListRequestError(
      timedOut ? "timeout" : "network",
      timedOut ? "AniList request timed out" : "AniList request failed",
      undefined,
      undefined,
      { cause },
    );
  }

  const now = options.now?.() ?? Date.now();
  if (response.status === 429) {
    const retryAfterMs =
      parseRetryAfterMs(response.headers.get("retry-after"), now) ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
    startCooldown(retryAfterMs, now);
    await response.body?.cancel().catch(() => undefined);
    throw new AniListRequestError("rate-limited", "AniList rate limited", 429, retryAfterMs);
  }

  // Spend the last of the budget gently: stop before the server says 429.
  // Only a header that is present counts: `Number(null)` is 0, which read a
  // response without rate-limit headers as "budget exhausted".
  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  const resetHeader = response.headers.get("x-ratelimit-reset");
  const remaining = remainingHeader === null ? Number.NaN : Number(remainingHeader);
  const resetAtSeconds = resetHeader === null ? Number.NaN : Number(resetHeader);
  if (Number.isFinite(remaining) && remaining <= LOW_BUDGET_THRESHOLD) {
    const resetInMs = Number.isFinite(resetAtSeconds) ? resetAtSeconds * 1000 - now : 0;
    startCooldown(resetInMs > 0 ? resetInMs : DEFAULT_RATE_LIMIT_BACKOFF_MS / 4, now);
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await response.text());
  } catch (cause) {
    if (!response.ok) {
      throw new AniListRequestError("http", `AniList HTTP ${response.status}`, response.status);
    }
    throw new AniListRequestError(
      "unreadable",
      "AniList answered with an unreadable body",
      response.status,
      undefined,
      { cause },
    );
  }
  if (!response.ok) {
    throw new AniListRequestError("http", `AniList HTTP ${response.status}`, response.status);
  }
  if (!isJsonObject(parsed)) {
    throw new AniListRequestError(
      "unreadable",
      "AniList answered with a non-object body",
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

function joinWithSignal<T>(task: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
