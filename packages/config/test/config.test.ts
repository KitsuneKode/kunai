import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CONFIG,
  mergeKitsuneConfig,
  parseKitsuneConfigPartial,
  parseProviderRelayConfig,
} from "../src/index";

describe("@kunai/config parse boundary", () => {
  test("parseProviderRelayConfig falls back to defaults on invalid input", () => {
    expect(parseProviderRelayConfig(null)).toEqual(DEFAULT_CONFIG.providerRelay);
    expect(parseProviderRelayConfig({ baseUrl: "not-a-url" })).toEqual(
      DEFAULT_CONFIG.providerRelay,
    );
  });

  test("parseProviderRelayConfig accepts valid relay config", () => {
    expect(
      parseProviderRelayConfig({
        enabled: false,
        baseUrl: "https://relay.example.com",
        token: "secret",
        fallbackToDirect: false,
        providers: { allanime: { enabled: true } },
      }),
    ).toMatchObject({
      enabled: false,
      baseUrl: "https://relay.example.com",
      token: "secret",
      fallbackToDirect: false,
    });
  });

  test("parseKitsuneConfigPartial preserves unknown keys", () => {
    expect(parseKitsuneConfigPartial({ provider: "videasy", unknownKey: 1 })).toMatchObject({
      provider: "videasy",
      unknownKey: 1,
    });
  });

  test("mergeKitsuneConfig normalizes providerRelay", () => {
    const merged = mergeKitsuneConfig(DEFAULT_CONFIG, {
      providerRelay: {
        enabled: true,
        baseUrl: "",
        token: "",
        fallbackToDirect: true,
        providers: {},
      },
    });
    expect(merged.providerRelay).toEqual(DEFAULT_CONFIG.providerRelay);
  });

  test("defaults put Videasy first in the series automatic lane", () => {
    expect(DEFAULT_CONFIG.provider).toBe("videasy");
    expect(DEFAULT_CONFIG.providerPriority).toEqual(["rivestream", "vidlink"]);
    expect(DEFAULT_CONFIG.providerPriority).not.toContain("videasy");
  });

  test("defaults keep Miruro out of the automatic anime fallback lane", () => {
    expect(DEFAULT_CONFIG.animeProvider).toBe("allanime");
    expect(DEFAULT_CONFIG.animeProviderPriority).toEqual(["allanime"]);
    expect(DEFAULT_CONFIG.animeProviderPriority).not.toContain("miruro");
  });
});
