import { describe, expect, test } from "bun:test";

import {
  fetchHealthyInvidiousInstances,
  markInvidiousInstanceFailure,
  pickInvidiousInstance,
} from "@kunai/providers/youtube";

describe("invidious instance reachability", () => {
  // Upstream now reports every working clearnet instance as `api: false`, while
  // every `api: null` entry is a non-routable overlay-network address. Selecting
  // on `api` alone therefore keeps only the hosts a normal machine cannot reach.
  const UPSTREAM_SHAPE = JSON.stringify([
    ["invidious.nerdvpn.de", { api: false, uri: "https://invidious.nerdvpn.de" }],
    ["inv.nadeko.net", { api: false, uri: "https://inv.nadeko.net" }],
    ["inv.nadeko.ygg", { api: null, uri: "https://inv.nadeko.ygg" }],
    ["nadeko.b32.i2p", { api: null, uri: "http://nadeko.b32.i2p" }],
    ["invidious-nerdvpn.i2p", { api: null, uri: "http://invidious-nerdvpn.i2p" }],
    ["nadeko.onion", { api: null, uri: "http://nadeko.onion" }],
  ]);

  // The pool caches the fetched list for 15 minutes in module scope, so each
  // case advances the clock past that window and stays below the later
  // "invidious instance pool" cases, which would otherwise read this fixture.
  async function fetchWith(body: string, now: number) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      return await fetchHealthyInvidiousInstances({
        instancesUrl: `https://fixtures.test/instances-${now}.json`,
        now: () => now,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  test("keeps reachable clearnet instances and drops overlay-network hosts", async () => {
    const instances = await fetchWith(UPSTREAM_SHAPE, 1_800_000_000_000);
    expect(instances).toEqual(["https://invidious.nerdvpn.de", "https://inv.nadeko.net"]);
  });

  test("never returns a .onion, .i2p or .ygg address", async () => {
    const instances = await fetchWith(UPSTREAM_SHAPE, 1_800_002_000_000);
    expect(instances.length).toBeGreaterThan(0);
    for (const instance of instances) {
      expect(instance).not.toMatch(/\.(onion|i2p|ygg)$/);
    }
  });

  test("prefers api-enabled hosts when upstream marks any clearnet host api:true", async () => {
    const instances = await fetchWith(
      JSON.stringify([
        ["quiet.invidious.test", { api: false, uri: "https://quiet.invidious.test" }],
        ["loud.invidious.test", { api: true, uri: "https://loud.invidious.test" }],
        ["hidden.onion", { api: true, uri: "http://hidden.onion" }],
      ]),
      1_800_004_000_000,
    );
    expect(instances).toEqual(["https://loud.invidious.test"]);
  });
});

describe("invidious instance pool", () => {
  test("preferredInstanceUrl normalizes custom instance", async () => {
    const instances = await fetchHealthyInvidiousInstances({
      preferredInstanceUrl: "yewtu.be/",
    });
    expect(instances).toEqual(["https://yewtu.be"]);
  });

  test("pickInvidiousInstance returns preferred instance without network", async () => {
    const instance = await pickInvidiousInstance({
      preferredInstanceUrl: "https://inv.custom.test",
    });
    expect(instance).toBe("https://inv.custom.test");
  });

  test("cooled-down instances are filtered from fetched pool", async () => {
    const now = 1_900_000_000_000;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify([
          ["bad.invidious.test", { api: true }],
          ["good.invidious.test", { api: true }],
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    try {
      markInvidiousInstanceFailure("https://bad.invidious.test", now);
      const instances = await fetchHealthyInvidiousInstances({
        instancesUrl: "https://fixtures.test/instances.json",
        now: () => now + 1,
      });
      expect(instances).toEqual(["https://good.invidious.test"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/**
 * A 200 that selects zero reachable instances is a degraded registry, a changed
 * response shape, or a list where nothing is usable — not a healthy pool.
 *
 * It was cached for the full 15-minute TTL, so `pickInvidiousInstance` threw
 * "No healthy Invidious instances available" from a *cached* empty pool on
 * every attempt until expiry, keeping YouTube broken long after the registry
 * recovered. Thrown requests and non-OK responses were already left uncached;
 * this was the third path to the same state.
 */
describe("an empty selection is not a healthy pool", () => {
  function serve(body: string, status = 200) {
    globalThis.fetch = (async () =>
      new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
  }

  test("an empty selection does not replace a pool that already worked", async () => {
    const originalFetch = globalThis.fetch;
    const url = "https://fixtures.test/instances-empty-selection.json";
    try {
      // A healthy pass populates the cache.
      serve(JSON.stringify([["good.example", { api: false, uri: "https://good.example" }]]));
      const healthy = await fetchHealthyInvidiousInstances({
        instancesUrl: url,
        now: () => 1_900_000_000_000,
      });
      expect(healthy).toEqual(["https://good.example"]);

      // Past the TTL, the registry answers 200 with nothing selectable.
      serve(JSON.stringify([["only.onion", { api: null, uri: "http://only.onion" }]]));
      const afterDegraded = await fetchHealthyInvidiousInstances({
        instancesUrl: url,
        now: () => 1_900_000_000_000 + 16 * 60 * 1000,
      });

      // The previous non-empty pool is better evidence than an empty one.
      expect(afterDegraded).toEqual(["https://good.example"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a recovered registry is picked up immediately, not after a stale TTL", async () => {
    const originalFetch = globalThis.fetch;
    const url = "https://fixtures.test/instances-recovery.json";
    try {
      // First contact is degraded, so there is no previous pool to fall back to.
      serve(JSON.stringify([["only.i2p", { api: null, uri: "http://only.i2p" }]]));
      const degraded = await fetchHealthyInvidiousInstances({
        instancesUrl: url,
        now: () => 2_000_000_000_000,
      });
      expect(degraded).toEqual([]);

      // One second later the registry is healthy again. Before the fix the
      // empty pool was cached, so this still returned nothing for 15 minutes.
      serve(JSON.stringify([["back.example", { api: false, uri: "https://back.example" }]]));
      const recovered = await fetchHealthyInvidiousInstances({
        instancesUrl: url,
        now: () => 2_000_000_000_000 + 1_000,
      });
      expect(recovered).toEqual(["https://back.example"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a broken registry falls back to the previous pool instead of failing search", async () => {
    const url = "https://fixtures.test/instances-stale.json";
    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify([["a.test", { uri: "https://a.test", api: true }]]), {
          status: 200,
        });
      }
      throw new Error("registry unreachable");
    }) as unknown as typeof fetch;

    try {
      const first = await fetchHealthyInvidiousInstances({ instancesUrl: url, now: () => 0 });
      expect(first).toEqual(["https://a.test"]);

      // Past the 15-minute TTL, so the registry is refetched and now fails.
      const afterTtl = 16 * 60 * 1000;
      const second = await fetchHealthyInvidiousInstances({
        instancesUrl: url,
        now: () => afterTtl,
      });
      expect(second).toEqual(["https://a.test"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a malformed registry payload falls back to the previous pool", async () => {
    // A 200 carrying the wrong shape (an object, not the [uri, meta] array) would
    // throw on `.map` and bypass the stale-cache fallback if selection ran
    // outside the try block.
    const url = "https://fixtures.test/instances-malformed.json";
    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify([["a.test", { uri: "https://a.test", api: true }]]), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: "maintenance" }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const first = await fetchHealthyInvidiousInstances({ instancesUrl: url, now: () => 0 });
      expect(first).toEqual(["https://a.test"]);
      const second = await fetchHealthyInvidiousInstances({
        instancesUrl: url,
        now: () => 16 * 60 * 1000,
      });
      expect(second).toEqual(["https://a.test"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a malformed payload with no previous pool surfaces an error, not a crash", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    try {
      await expect(
        fetchHealthyInvidiousInstances({
          instancesUrl: "https://fixtures.test/instances-bad-shape.json",
          now: () => 0,
        }),
      ).rejects.toThrow("unexpected shape");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a registry failure with no previous pool still surfaces the error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("registry unreachable");
    }) as unknown as typeof fetch;

    try {
      await expect(
        fetchHealthyInvidiousInstances({
          instancesUrl: "https://fixtures.test/instances-never-seen.json",
          now: () => 0,
        }),
      ).rejects.toThrow("registry unreachable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
