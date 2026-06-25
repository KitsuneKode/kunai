import { describe, expect, test } from "bun:test";

import {
  fetchHealthyInvidiousInstances,
  markInvidiousInstanceFailure,
  pickInvidiousInstance,
} from "@kunai/providers/youtube";

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
