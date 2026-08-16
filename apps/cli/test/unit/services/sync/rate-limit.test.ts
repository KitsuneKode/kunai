import { describe, expect, test } from "bun:test";

import { readRateLimitHeaders, TrackerRateLimiter } from "@/services/sync/rate-limit";

const response = (status: number, headers: Record<string, string>) =>
  new Response(null, { status, headers });

describe("readRateLimitHeaders", () => {
  test("reads AniList's documented success headers", () => {
    const snapshot = readRateLimitHeaders(
      response(200, { "X-RateLimit-Limit": "90", "X-RateLimit-Remaining": "59" }),
    );

    expect(snapshot.limit).toBe(90);
    expect(snapshot.remaining).toBe(59);
    expect(snapshot.retryAfterMs).toBeNull();
  });

  test("reads Retry-After and the reset timestamp from a 429", () => {
    const resetSeconds = Math.floor(Date.now() / 1000) + 42;
    const snapshot = readRateLimitHeaders(
      response(429, {
        "Retry-After": "30",
        "X-RateLimit-Limit": "90",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
      }),
    );

    expect(snapshot.retryAfterMs).toBe(30_000);
    expect(snapshot.remaining).toBe(0);
    expect(snapshot.resetAt).toBe(resetSeconds * 1000);
  });

  /**
   * A 429 with no usable `Retry-After` must still produce a wait. Returning
   * null there would let the caller treat it as an ordinary failure and retry
   * on its own schedule, which is how a client keeps hammering a limiter.
   */
  test("falls back to a bounded default when a 429 carries no Retry-After", () => {
    const cases: Record<string, string>[] = [{}, { "Retry-After": "" }, { "Retry-After": "x" }];
    for (const headers of cases) {
      const snapshot = readRateLimitHeaders(response(429, headers));
      expect(snapshot.retryAfterMs).toBe(60_000);
    }
  });

  /** A malicious or broken header must not park a row for a year. */
  test("clamps an absurd Retry-After", () => {
    const snapshot = readRateLimitHeaders(response(429, { "Retry-After": "99999999" }));
    expect(snapshot.retryAfterMs).toBe(60 * 60 * 1000);
  });

  test("reports nothing when the tracker sends no rate-limit headers", () => {
    const snapshot = readRateLimitHeaders(response(200, {}));
    expect(snapshot).toEqual({ limit: null, remaining: null, resetAt: null, retryAfterMs: null });
  });
});

describe("TrackerRateLimiter", () => {
  const at = (ms: number) => () => ms;

  test("does not delay while the budget is comfortable", async () => {
    const limiter = new TrackerRateLimiter({ now: at(0) });
    limiter.observe(response(200, { "X-RateLimit-Limit": "90", "X-RateLimit-Remaining": "59" }));

    expect(limiter.delayBeforeNextRequestMs()).toBe(0);
  });

  /**
   * The point of pre-emptive spacing: as the budget runs down, spread what is
   * left across the time until it resets instead of spending it immediately and
   * taking a 429 for the rest of the window.
   */
  test("spaces requests once the remaining budget runs low", () => {
    const now = 1_000_000;
    const limiter = new TrackerRateLimiter({ now: at(now) });
    limiter.observe(
      response(200, {
        "X-RateLimit-Limit": "90",
        "X-RateLimit-Remaining": "4",
        "X-RateLimit-Reset": String(Math.floor(now / 1000) + 20),
      }),
    );

    // 20s of window left, 4 requests to spend: one every 5s.
    expect(limiter.delayBeforeNextRequestMs()).toBe(5_000);
  });

  test("blocks until reset when the budget is exhausted", () => {
    const now = 1_000_000;
    const limiter = new TrackerRateLimiter({ now: at(now) });
    limiter.observe(
      response(200, {
        "X-RateLimit-Limit": "90",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor(now / 1000) + 12),
      }),
    );

    expect(limiter.delayBeforeNextRequestMs()).toBe(12_000);
  });

  test("honours Retry-After after a 429, and forgets it once it elapses", () => {
    let clock = 1_000_000;
    const limiter = new TrackerRateLimiter({ now: () => clock });
    limiter.observe(response(429, { "Retry-After": "30" }));

    expect(limiter.delayBeforeNextRequestMs()).toBe(30_000);

    clock += 30_000;
    expect(limiter.delayBeforeNextRequestMs()).toBe(0);
  });

  /** A per-request wait must never exceed the cap; the outbox owns long waits. */
  test("caps the in-drain wait so a drain cannot stall on one row", () => {
    const now = 1_000_000;
    const limiter = new TrackerRateLimiter({ now: at(now), maxInlineWaitMs: 2_000 });
    limiter.observe(response(429, { "Retry-After": "600" }));

    expect(limiter.delayBeforeNextRequestMs()).toBe(600_000);
    expect(limiter.inlineWaitMs()).toBe(2_000);
  });
});
