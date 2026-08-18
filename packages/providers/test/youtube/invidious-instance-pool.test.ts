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
