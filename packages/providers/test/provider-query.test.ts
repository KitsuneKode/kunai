import { describe, expect, test } from "bun:test";

import { ProviderQueryCache } from "../src/shared/provider-query";

function deferred<T>() {
  let resolve!: (value: T) => void;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise reject callbacks carry untyped thrown values
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ProviderQueryCache in-flight dedup", () => {
  test("concurrent queries for the same key share one fetch", async () => {
    let calls = 0;
    const cache = new ProviderQueryCache<string, string>({ ttlMs: 1_000 });
    const gate = deferred<string>();

    const first = cache.query("k", () => {
      calls += 1;
      return gate.promise;
    });
    const second = cache.query("k", () => {
      calls += 1;
      return gate.promise;
    });

    gate.resolve("value");
    expect(await first).toBe("value");
    expect(await second).toBe("value");
    expect(calls).toBe(1);
  });

  test("a failed shared fetch does not poison the next call", async () => {
    let calls = 0;
    const cache = new ProviderQueryCache<string, string>({ ttlMs: 1_000 });

    await expect(
      cache.query("k", () => {
        calls += 1;
        return Promise.reject(new Error("offline"));
      }),
    ).rejects.toThrow("offline");
    // A joiner that arrives after the failure must fetch fresh, not replay it.
    expect(await cache.query("k", () => Promise.resolve("recovered"))).toBe("recovered");
    expect(calls).toBe(1);
  });
});

describe("ProviderQueryCache TTL", () => {
  test("serves fresh entries without refetching and refetches after expiry", async () => {
    let now = 0;
    let calls = 0;
    const cache = new ProviderQueryCache<string, number>({
      ttlMs: 100,
      now: () => now,
    });
    const fetcher = () => {
      calls += 1;
      return Promise.resolve(calls);
    };

    expect(await cache.query("k", fetcher)).toBe(1);
    expect(await cache.query("k", fetcher)).toBe(1);
    expect(calls).toBe(1);

    now = 101;
    expect(await cache.query("k", fetcher)).toBe(2);
    expect(calls).toBe(2);
  });

  test("dynamic ttlMs reads the resolved value for upstream lifetimes", async () => {
    let now = 0;
    const cache = new ProviderQueryCache<string, { seed: string; ttlMs: number }>({
      ttlMs: (value) => value.ttlMs,
      now: () => now,
    });

    await cache.query("k", () => Promise.resolve({ seed: "s", ttlMs: 50 }));
    now = 49;
    expect(cache.get("k")?.seed).toBe("s");
    now = 51;
    expect(cache.get("k")).toBeUndefined();
  });

  test("refreshHeadroomMs treats entries nearing expiry as stale", async () => {
    let now = 0;
    let calls = 0;
    const cache = new ProviderQueryCache<string, number>({
      ttlMs: 100,
      refreshHeadroomMs: 20,
      now: () => now,
    });

    await cache.query("k", () => {
      calls += 1;
      return Promise.resolve(calls);
    });
    now = 81; // inside the last-20ms headroom window
    expect(await cache.query("k", () => Promise.resolve(99))).toBe(99);
    expect(calls).toBe(1);
    // Headroom-stale but not expired: still readable as a stale fact.
    expect(cache.get("k")).toBe(99);
  });
});

describe("ProviderQueryCache stale-if-error", () => {
  test("boolean policy serves the stale entry when refresh fails", async () => {
    let now = 0;
    const cache = new ProviderQueryCache<string, string>({
      ttlMs: 100,
      staleIfError: true,
      now: () => now,
    });

    await cache.query("k", () => Promise.resolve("healthy"));
    now = 200;

    await expect(cache.query("k", () => Promise.reject(new Error("registry down")))).resolves.toBe(
      "healthy",
    );
    // The stale entry is kept for the next caller too.
    await expect(cache.query("k", () => Promise.reject(new Error("still down")))).resolves.toBe(
      "healthy",
    );
  });

  test("predicate sees the error and call — a caller abort is never masked", async () => {
    let now = 0;
    const cache = new ProviderQueryCache<string, string>({
      ttlMs: 100,
      staleIfError: (error, call) =>
        !(call?.signal?.aborted || (error instanceof Error && error.name === "AbortError")),
      now: () => now,
    });

    await cache.query("k", () => Promise.resolve("healthy"));
    now = 200;

    const controller = new AbortController();
    controller.abort();
    await expect(
      cache.query("k", () => Promise.reject(new Error("aborted")), {
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
  });

  test("without staleIfError a failed refresh rethrows and drops the entry", async () => {
    let now = 0;
    const cache = new ProviderQueryCache<string, string>({
      ttlMs: 100,
      now: () => now,
    });

    await cache.query("k", () => Promise.resolve("v1"));
    now = 200;
    await expect(cache.query("k", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(cache.get("k")).toBeUndefined();
    expect(await cache.query("k", () => Promise.resolve("v2"))).toBe("v2");
  });

  test("a joiner on a failed refresh also receives the stale value", async () => {
    let now = 0;
    const cache = new ProviderQueryCache<string, string>({
      ttlMs: 100,
      staleIfError: true,
      now: () => now,
    });

    await cache.query("k", () => Promise.resolve("healthy"));
    now = 200;

    const gate = deferred<string>();
    const first = cache.query("k", () => gate.promise);
    const joined = cache.query("k", () => Promise.resolve("unused"));
    gate.reject(new Error("refresh failed"));

    expect(await first).toBe("healthy");
    expect(await joined).toBe("healthy");
  });
});

describe("ProviderQueryCache cacheIf", () => {
  test("values failing the predicate are returned but never stored", async () => {
    let calls = 0;
    const cache = new ProviderQueryCache<string, string[]>({
      ttlMs: 60_000,
      cacheIf: (value) => value.length > 0,
    });

    const empty = await cache.query("k", () => {
      calls += 1;
      return Promise.resolve([]);
    });
    expect(empty).toEqual([]);
    expect(cache.size).toBe(0);
    // Next call refetches rather than replaying the empty answer.
    expect(await cache.query("k", () => Promise.resolve(["a"]))).toEqual(["a"]);
    expect(cache.size).toBe(1);
    expect(calls).toBe(1);
  });
});

describe("ProviderQueryCache bounds and clock basis", () => {
  test("maxEntries evicts oldest-inserted once the bound is exceeded", async () => {
    const cache = new ProviderQueryCache<string, number>({ ttlMs: 10_000, maxEntries: 2 });
    const fetch = (n: number) => () => Promise.resolve(n);

    await cache.query("a", fetch(1));
    await cache.query("b", fetch(2));
    await cache.query("c", fetch(3));

    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  test("eviction sweeps expired entries before evicting live ones", async () => {
    let now = 0;
    const cache = new ProviderQueryCache<string, { n: number; ttl: number }>({
      ttlMs: (v) => v.ttl,
      maxEntries: 2,
      now: () => now,
    });
    const fetch = (n: number, ttl: number) => () => Promise.resolve({ n, ttl });

    // `live` is inserted first; `short` expires at 50 while `live` runs to 200.
    await cache.query("live", fetch(1, 200));
    await cache.query("short", fetch(2, 50));
    now = 100;
    // Without the expired sweep, oldest-inserted eviction would drop `live`.
    await cache.query("c", fetch(3, 200));

    expect(cache.get("live")?.n).toBe(1);
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("c")?.n).toBe(3);
  });

  test("per-call `at` stamps and sweeps in the injected clock basis", async () => {
    // Regression: entries written at an injected epoch used to be swept as
    // "expired" because the bound check ran on the real wall clock.
    const cache = new ProviderQueryCache<string, string>({ ttlMs: 100, maxEntries: 2 });

    await cache.query("a", () => Promise.resolve("va"), { at: 0 });
    await cache.query("b", () => Promise.resolve("vb"), { at: 60 });
    await cache.query("c", () => Promise.resolve("vc"), { at: 150 });

    expect(cache.get("a", { at: 150 })).toBeUndefined(); // expired in its own basis
    expect(cache.get("b", { at: 149 })).toBe("vb");
    expect(cache.get("c", { at: 150 })).toBe("vc");
    expect(cache.get("b", { at: 161 })).toBeUndefined();
  });
});

describe("ProviderQueryCache invalidation", () => {
  test("invalidate drops the stored entry so the next query refetches", async () => {
    let calls = 0;
    const cache = new ProviderQueryCache<string, number>({ ttlMs: 60_000 });

    await cache.query("k", () => {
      calls += 1;
      return Promise.resolve(calls);
    });
    cache.invalidate("k");
    expect(await cache.query("k", () => Promise.resolve(99))).toBe(99);
    expect(calls).toBe(1);
  });

  test("reset clears entries and drops in-flight bookkeeping", async () => {
    const cache = new ProviderQueryCache<string, string>({ ttlMs: 60_000 });
    await cache.query("a", () => Promise.resolve("va"));
    cache.reset();
    expect(cache.size).toBe(0);
    expect(await cache.query("a", () => Promise.resolve("vb"))).toBe("vb");
  });
});
