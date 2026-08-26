import { beforeEach, describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  clearWingsTransportCachesForTest,
  fetchWingsdatabaseSeedForTest,
  WINGS_API_BASE,
  WINGS_API_BASES,
  wingsPenalizedHostsForTest,
} from "../src/videasy/direct";

/**
 * Production runs a single Wings host today, but the transport still races N of
 * them, and the behaviours worth pinning here — who gets blamed for a failure,
 * and who must not be — only exist with more than one. These two synthetic
 * hosts exercise that machinery without asserting that any particular mirror is
 * alive, which is exactly the coupling that let a dead `api.wingsdatabase.com`
 * sit in the rotation looking like redundancy.
 */
const TEST_PRIMARY = "https://primary.wings.test";
const TEST_MIRROR = "https://mirror.wings.test";
const TEST_HOSTS = [TEST_PRIMARY, TEST_MIRROR] as const;

/**
 * A deferred request: the test decides exactly when each host answers, so the
 * race outcome never depends on timers or real network ordering.
 */
type Deferred = {
  readonly resolve: (body: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly aborted: () => boolean;
};

function createRequester(hosts: readonly string[] = WINGS_API_BASES) {
  const pending = new Map<string, Deferred>();
  const calls: string[] = [];

  const requester = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const host = hosts.find((candidate) => url.startsWith(candidate));
    if (!host) throw new Error(`unexpected seed host in request: ${url}`);
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

describe("Wings host configuration", () => {
  /**
   * `api.wingsdatabase.com` was removed on 2026-08-26 as NXDOMAIN. A host that
   * can never answer is not redundancy — it costs a request slot and a penalty
   * entry per cold resolve — so the rotation must not quietly regrow one.
   */
  test("every configured host is a live-looking absolute origin", () => {
    expect(WINGS_API_BASES.length).toBeGreaterThan(0);
    expect(WINGS_API_BASES).toContain(WINGS_API_BASE);
    expect(WINGS_API_BASES).not.toContain("https://api.wingsdatabase.com");
    for (const base of WINGS_API_BASES) {
      expect(base.startsWith("https://")).toBe(true);
      expect(base.endsWith("/")).toBe(false);
    }
  });
});

describe("Wings seed race outcomes", () => {
  test("the configured production host wins and pairs its seed with itself", async () => {
    const harness = createRequester();
    const pendingResult = fetchWingsdatabaseSeedForTest(1, createContext(harness.requester));

    await harness.settle(WINGS_API_BASE, SEED_BODY);

    expect(await pendingResult).toEqual({ apiBase: WINGS_API_BASE, seed: "seed-value" });
  });

  test("a mirror wins and its seed is paired with the mirror host", async () => {
    const harness = createRequester(TEST_HOSTS);
    const pendingResult = fetchWingsdatabaseSeedForTest(
      2,
      createContext(harness.requester),
      undefined,
      TEST_HOSTS,
    );

    await harness.settle(TEST_MIRROR, SEED_BODY);

    expect(await pendingResult).toEqual({ apiBase: TEST_MIRROR, seed: "seed-value" });
  });

  test("a loser aborted after the winner is not penalized", async () => {
    const first = createRequester(TEST_HOSTS);
    const firstResult = fetchWingsdatabaseSeedForTest(
      3,
      createContext(first.requester),
      undefined,
      TEST_HOSTS,
    );
    await first.settle(TEST_PRIMARY, SEED_BODY);
    await firstResult;

    // The mirror lost and was aborted. That is not evidence about the host.
    expect(wingsPenalizedHostsForTest(TEST_HOSTS)).toEqual([]);
  });

  test("a genuine pre-winner failure penalizes only that host", async () => {
    const first = createRequester(TEST_HOSTS);
    const firstResult = fetchWingsdatabaseSeedForTest(
      5,
      createContext(first.requester),
      undefined,
      TEST_HOSTS,
    );
    await first.fail(TEST_PRIMARY, "seed HTTP 500");
    await first.settle(TEST_MIRROR, SEED_BODY);
    expect(await firstResult).toEqual({ apiBase: TEST_MIRROR, seed: "seed-value" });

    // The primary is in the penalty box, so the next request skips it entirely.
    const second = createRequester(TEST_HOSTS);
    const secondResult = fetchWingsdatabaseSeedForTest(
      6,
      createContext(second.requester),
      undefined,
      TEST_HOSTS,
    );
    await second.settle(TEST_MIRROR, SEED_BODY);
    await secondResult;

    expect(second.calls).toEqual([TEST_MIRROR]);
    expect(wingsPenalizedHostsForTest(TEST_HOSTS)).toEqual([TEST_PRIMARY]);
  });

  test("when every host fails the result is undefined", async () => {
    const harness = createRequester(TEST_HOSTS);
    const pendingResult = fetchWingsdatabaseSeedForTest(
      7,
      createContext(harness.requester),
      undefined,
      TEST_HOSTS,
    );

    await harness.fail(TEST_PRIMARY, "seed HTTP 500");
    await harness.fail(TEST_MIRROR, "seed HTTP 500");

    expect(await pendingResult).toBeUndefined();
    expect(wingsPenalizedHostsForTest(TEST_HOSTS)).toEqual([TEST_PRIMARY, TEST_MIRROR]);
  });

  test("all hosts penalized still races them rather than giving up forever", async () => {
    const first = createRequester(TEST_HOSTS);
    const firstResult = fetchWingsdatabaseSeedForTest(
      8,
      createContext(first.requester),
      undefined,
      TEST_HOSTS,
    );
    await first.fail(TEST_PRIMARY, "seed HTTP 500");
    await first.fail(TEST_MIRROR, "seed HTTP 500");
    await firstResult;

    const second = createRequester(TEST_HOSTS);
    const secondResult = fetchWingsdatabaseSeedForTest(
      9,
      createContext(second.requester),
      undefined,
      TEST_HOSTS,
    );
    await second.settle(TEST_PRIMARY, SEED_BODY);

    expect(await secondResult).toEqual({ apiBase: TEST_PRIMARY, seed: "seed-value" });
  });

  /**
   * The bug this test pins: caller cancellation rejected every in-flight attempt,
   * and the catch could not tell that apart from a real failure, so walking away
   * from a playback put both Wings hosts in the penalty box for five minutes.
   */
  test("caller abort penalizes neither host", async () => {
    const controller = new AbortController();
    const first = createRequester(TEST_HOSTS);
    const firstResult = fetchWingsdatabaseSeedForTest(
      10,
      createContext(first.requester, controller.signal),
      undefined,
      TEST_HOSTS,
    );

    await Promise.resolve();
    controller.abort();

    expect(await firstResult).toBeUndefined();
    expect(wingsPenalizedHostsForTest(TEST_HOSTS)).toEqual([]);
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

  /**
   * A preferred-host entry can outlive the host it names when a mirror is
   * retired. It must not put that dead host back at the front of the race.
   */
  test("a preferred host that is no longer configured is not resurrected", async () => {
    const first = createRequester(TEST_HOSTS);
    const firstResult = fetchWingsdatabaseSeedForTest(
      13,
      createContext(first.requester),
      undefined,
      TEST_HOSTS,
    );
    await first.settle(TEST_MIRROR, SEED_BODY);
    await firstResult;

    // The mirror is retired: only the primary remains configured.
    const second = createRequester([TEST_PRIMARY]);
    const secondResult = fetchWingsdatabaseSeedForTest(
      13,
      createContext(second.requester),
      undefined,
      [TEST_PRIMARY],
    );
    await second.settle(TEST_PRIMARY, SEED_BODY);

    expect(await secondResult).toEqual({ apiBase: TEST_PRIMARY, seed: "seed-value" });
    expect(second.calls).toEqual([TEST_PRIMARY]);
  });
});
