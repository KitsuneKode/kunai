import { afterEach, describe, expect, test } from "bun:test";

import { providerDnsSettingsRows } from "@/app-shell/settings/registry/relay";
import { createProviderDnsResolver } from "@/container/bootstrap-providers";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigService";
import { getProviderDohResolver, setProviderDohResolver } from "@kunai/core";

afterEach(() => setProviderDohResolver(null));

describe("provider DNS setting", () => {
  test("system mode and KUNAI_DOH_DISABLE both mean system DNS, read live", async () => {
    let mode: "doh" | "system" = "system";
    const resolver = createProviderDnsResolver(
      () => mode,
      () => {},
      {},
    );
    expect(await resolver.resolve("api.example.com")).toBeNull();

    // Flipping the setting applies to the next lookup; `nas.lan` stays local in either mode.
    mode = "doh";
    expect(await resolver.resolve("nas.lan")).toBeNull();

    const forcedOff = createProviderDnsResolver(
      () => "doh",
      () => {},
      { KUNAI_DOH_DISABLE: "1" },
    );
    expect(await forcedOff.resolve("api.example.com")).toBeNull();
  });

  test("defaults on, and the Settings switch writes the two stored values", () => {
    expect(DEFAULT_CONFIG.providerDns).toBe("doh");
    const row = providerDnsSettingsRows().find((candidate) => candidate.id === "providerDns");
    if (!row || row.kind !== "boolean") throw new Error("providerDns switch missing");
    expect(row.read(DEFAULT_CONFIG)).toBe(true);
    expect(row.write(DEFAULT_CONFIG, false).providerDns).toBe("system");
    expect(row.write({ ...DEFAULT_CONFIG, providerDns: "system" }, true).providerDns).toBe("doh");
  });

  test("concurrent lookups for one host share a single query", async () => {
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "203.0.113.9", TTL: 60 }] });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () => {
        started += 1;
        await gate;
        return new Response(body);
      },
      { preconnect: originalFetch.preconnect },
    );
    try {
      const resolver = createProviderDnsResolver(
        () => "doh",
        () => {},
        {},
      );
      const all = Promise.all([1, 2, 3].map(() => resolver.resolve("shared.example.com")));
      await Promise.resolve();
      // One A and one AAAA query for three callers.
      expect(started).toBe(2);
      release();
      const answers = await all;
      expect(answers.every((answer) => answer?.[0]?.address === "203.0.113.9")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("the composition root's resolver is the one curl reads", () => {
    const resolver = createProviderDnsResolver(
      () => "doh",
      () => {},
      {},
    );
    setProviderDohResolver(resolver);
    expect(getProviderDohResolver()).toBe(resolver);
  });
});
