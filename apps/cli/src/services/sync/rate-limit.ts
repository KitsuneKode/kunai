/**
 * Client-side pacing for tracker APIs.
 *
 * AniList publishes a budget on every response — `X-RateLimit-Limit: 90`,
 * `X-RateLimit-Remaining: 59` — and answers `429` with `Retry-After` and
 * `X-RateLimit-Reset` once it is spent. Ignoring all of that is what turns one
 * drain of 25 queued rows into 25 requests the server has already refused.
 *
 * Two things are separated deliberately:
 *
 * - `inlineWaitMs()` is what a single request may sit and wait for. It is
 *   capped, because a drain holding a claim lease open is not a good place to
 *   sleep for ten minutes.
 * - `delayBeforeNextRequestMs()` is the honest full wait. When it exceeds the
 *   inline cap the caller stops and hands the row back to the outbox with that
 *   number, so the wait is durable and survives a restart.
 */

/** A 429 with no usable `Retry-After` still has to produce a wait. */
const DEFAULT_RETRY_AFTER_MS = 60_000;
/** A broken or hostile header must not park work for a year. */
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
/** Below this share of the budget, start spreading what is left. */
const LOW_BUDGET_THRESHOLD = 10;
/** Longest a single request may block in-drain before deferring instead. */
const DEFAULT_MAX_INLINE_WAIT_MS = 3_000;

export interface RateLimitSnapshot {
  readonly limit: number | null;
  readonly remaining: number | null;
  /** Epoch milliseconds when the budget refills. */
  readonly resetAt: number | null;
  /** Set only for a 429. */
  readonly retryAfterMs: number | null;
}

function positiveInt(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function readRateLimitHeaders(response: Response): RateLimitSnapshot {
  const limit = positiveInt(response.headers.get("X-RateLimit-Limit"));
  const remaining = positiveInt(response.headers.get("X-RateLimit-Remaining"));
  const resetSeconds = positiveInt(response.headers.get("X-RateLimit-Reset"));

  let retryAfterMs: number | null = null;
  if (response.status === 429) {
    const retryAfterSeconds = positiveInt(response.headers.get("Retry-After"));
    retryAfterMs = Math.min(
      (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_MS / 1000) * 1000,
      MAX_RETRY_AFTER_MS,
    );
  }

  return {
    limit,
    remaining,
    resetAt: resetSeconds === null ? null : resetSeconds * 1000,
    retryAfterMs,
  };
}

export interface TrackerRateLimiterOptions {
  readonly now?: () => number;
  readonly maxInlineWaitMs?: number;
}

export class TrackerRateLimiter {
  private readonly now: () => number;
  private readonly maxInlineWaitMs: number;
  /** Epoch ms before which no request may be sent. */
  private blockedUntil = 0;
  private snapshot: RateLimitSnapshot = {
    limit: null,
    remaining: null,
    resetAt: null,
    retryAfterMs: null,
  };

  constructor(options: TrackerRateLimiterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxInlineWaitMs = options.maxInlineWaitMs ?? DEFAULT_MAX_INLINE_WAIT_MS;
  }

  /** Record what a response said about the budget. Returns what was read. */
  observe(response: Response): RateLimitSnapshot {
    const snapshot = readRateLimitHeaders(response);
    this.snapshot = snapshot;
    if (snapshot.retryAfterMs !== null) {
      this.blockedUntil = this.now() + snapshot.retryAfterMs;
    }
    return snapshot;
  }

  getSnapshot(): RateLimitSnapshot {
    return this.snapshot;
  }

  /**
   * The full wait before the next request would be acceptable.
   *
   * A hard block from a 429 wins. Otherwise, once the budget drops below the
   * threshold, spread the remainder evenly across whatever is left of the
   * window — which is the difference between easing off and hitting the wall.
   */
  delayBeforeNextRequestMs(): number {
    const now = this.now();
    const blocked = Math.max(0, this.blockedUntil - now);
    if (blocked > 0) return blocked;

    const { remaining, resetAt } = this.snapshot;
    if (remaining === null || resetAt === null) return 0;

    const windowMs = Math.max(0, resetAt - now);
    if (windowMs === 0) return 0;
    if (remaining === 0) return windowMs;
    if (remaining >= LOW_BUDGET_THRESHOLD) return 0;

    return Math.ceil(windowMs / remaining);
  }

  /** The part of that wait a single in-flight request may absorb directly. */
  inlineWaitMs(): number {
    return Math.min(this.delayBeforeNextRequestMs(), this.maxInlineWaitMs);
  }

  /** True when the wait is too long to sit through and the row should defer. */
  shouldDefer(): boolean {
    return this.delayBeforeNextRequestMs() > this.maxInlineWaitMs;
  }

  /** Sleep off the inline portion, if any. Cancellable. */
  async waitInline(signal: AbortSignal): Promise<void> {
    const wait = this.inlineWaitMs();
    if (wait <= 0 || signal.aborted) return;
    // Composed rather than hand-raced: "the wait elapsed" and "the caller gave
    // up" become one signal, so there is a single place this can finish.
    const done = AbortSignal.any([signal, AbortSignal.timeout(wait)]);
    if (done.aborted) return;
    await new Promise<void>((resolve) => {
      done.addEventListener("abort", () => resolve(), { once: true });
    });
  }
}
