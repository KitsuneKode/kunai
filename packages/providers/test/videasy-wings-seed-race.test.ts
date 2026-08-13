import { beforeEach, describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  clearWingsTransportCachesForTest,
  fetchWingsdatabaseSeedForTest,
  WINGS_API_BASE,
  WINGS_API_FALLBACK_BASE,
  wingsPenalizedHostsForTest,
} from "../src/videasy/direct";

/**
 * A deferred request: the test decides exactly when each host answers, so the
 * race outcome never depends on timers or real network ordering.
 */
type Deferred = {
  readonly resolve: (body: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly aborted: () => boolean;
};

function createRequester() {
  const pending = new Map<string, Deferred>();
  const calls: string[] = [];

  const requester = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const host = url.startsWith(WINGS_API_BASE) ? WINGS_API_BASE : WINGS_API_FALLBACK_BASE;
    calls.push(host);
    return new Promise<Response>((resolve, reject) => {
      let wasAborted = false;
      const signal = init?.signal;
      const onAbort = () => {
        wasAborted = true;
        reject(new DOMException("aborted", "AbortError"));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });

      pending.set(host, {
        resolve: (body) => resolve(Response.json(body)),
        reject,
        aborted: () => wasAborted,
      });
    });
  };

  return {
    calls,
    requester,
    async settle(host: string, body: unknown) {
      // Let the racers register before answering.
      await Promise.resolve();
      pending.get(host)?.resolve(body);
    },
    async fail(host: string, message: string) {
      await Promise.resolve();
      pending.get(host)?.reject(new Error(message));
    },
  };
}

function createContext(
  requester: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): ProviderRuntimeContext {
  return {
    providerId: "videasy",
    now: () => new Date().toISOString(),
    signal,
    fetch: { runtime: "direct-http", fetch: requester },
  };
}

const SEED_BODY = { seed: "seed-value", ttlMs: 30_000 };

beforeEach(() => {
  clearWingsTransportCachesForTest();
});

describe("Wings seed race outcomes", () => {
  test("primary wins and its seed is paired with its own host", async () => {
    const harness = createRequester();
    const pendingResult = fetchWingsdatabaseSeedForTest(1, createContext(harness.requester));

    await harness.settle(WINGS_API_BASE, SEED_BODY);

    expect(await pendingResult).toEqual({ apiBase: WINGS_API_BASE, seed: "seed-value" });
  });

  test("fallback wins and its seed is paired with the fallback host", async () => {
    const harness = createRequester();
    const pendingResult = fetchWingsdatabaseSeedForTest(2, createContext(harness.requester));

    await harness.settle(WINGS_API_FALLBACK_BASE, SEED_BODY);

    expect(await pendingResult).toEqual({
      apiBase: WINGS_API_FALLBACK_BASE,
      seed: "seed-value",
    });
  });

  test("a loser aborted after the winner is not penalized", async () => {
    const first = createRequester();
    const firstResult = fetchWingsdatabaseSeedForTest(3, createContext(first.requester));
    await first.settle(WINGS_API_BASE, SEED_BODY);
    await firstResult;

    // The fallback lost and was aborted. That is not evidence about the host.
    expect(wingsPenalizedHostsForTest()).toEqual([]);
  });

  test("a genuine pre-winner failure penalizes only that host", async () => {
    const first = createRequester();
    const firstResult = fetchWingsdatabaseSeedForTest(5, createContext(first.requester));
    await first.fail(WINGS_API_BASE, "seed HTTP 500");
    await first.settle(WINGS_API_FALLBACK_BASE, SEED_BODY);
    expect(await firstResult).toEqual({ apiBase: WINGS_API_FALLBACK_BASE, seed: "seed-value" });

    // The primary is in the penalty box, so the next request skips it entirely.
    const second = createRequester();
    const secondResult = fetchWingsdatabaseSeedForTest(6, createContext(second.requester));
    await second.settle(WINGS_API_FALLBACK_BASE, SEED_BODY);
    await secondResult;

    expect(second.calls).toEqual([WINGS_API_FALLBACK_BASE]);
    expect(wingsPenalizedHostsForTest()).toEqual([WINGS_API_BASE]);
  });

  test("when every host fails the result is undefined", async () => {
    const harness = createRequester();
    const pendingResult = fetchWingsdatabaseSeedForTest(7, createContext(harness.requester));

    await harness.fail(WINGS_API_BASE, "seed HTTP 500");
    await harness.fail(WINGS_API_FALLBACK_BASE, "seed HTTP 500");

    expect(await pendingResult).toBeUndefined();
    expect(wingsPenalizedHostsForTest()).toEqual([WINGS_API_BASE, WINGS_API_FALLBACK_BASE]);
  });

  test("all hosts penalized still races them rather than giving up forever", async () => {
    const first = createRequester();
    const firstResult = fetchWingsdatabaseSeedForTest(8, createContext(first.requester));
    await first.fail(WINGS_API_BASE, "seed HTTP 500");
    await first.fail(WINGS_API_FALLBACK_BASE, "seed HTTP 500");
    await firstResult;

    const second = createRequester();
    const secondResult = fetchWingsdatabaseSeedForTest(9, createContext(second.requester));
    await second.settle(WINGS_API_BASE, SEED_BODY);

    expect(await secondResult).toEqual({ apiBase: WINGS_API_BASE, seed: "seed-value" });
  });

  /**
   * The bug this test pins: caller cancellation rejected every in-flight attempt,
   * and the catch could not tell that apart from a real failure, so walking away
   * from a playback put both Wings hosts in the penalty box for five minutes.
   */
  test("caller abort penalizes neither host", async () => {
    const controller = new AbortController();
    const first = createRequester();
    const firstResult = fetchWingsdatabaseSeedForTest(
      10,
      createContext(first.requester, controller.signal),
    );

    await Promise.resolve();
    controller.abort();

    expect(await firstResult).toBeUndefined();
    expect(wingsPenalizedHostsForTest()).toEqual([]);
  });

  test("a cached seed short-circuits the race for the same media id", async () => {
    const first = createRequester();
    const firstResult = fetchWingsdatabaseSeedForTest(12, createContext(first.requester));
    await first.settle(WINGS_API_BASE, SEED_BODY);
    await firstResult;

    const second = createRequester();

    expect(await fetchWingsdatabaseSeedForTest(12, createContext(second.requester))).toEqual({
      apiBase: WINGS_API_BASE,
      seed: "seed-value",
    });
    expect(second.calls).toEqual([]);
  });
});
