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

  test("parseProviderRelayConfig drops the retired video relay flag", () => {
    expect(
      parseProviderRelayConfig({
        baseUrl: "https://relay.example.com",
        providers: { allanime: { enabled: true, videoFallback: true } },
      }),
    ).toEqual({
      baseUrl: "https://relay.example.com",
      providers: { allanime: { enabled: true } },
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

  test("anime lane leads with Miruro and keeps AniDB and AllAnime behind it", () => {
    expect(DEFAULT_CONFIG.animeProvider).toBe("miruro");
    expect(DEFAULT_CONFIG.animeProviderPriority).toEqual([
      "miruro",
      "kickassanime",
      "animegg",
      "anidb",
      "allanime",
    ]);
  });

  test("a lane-default change ships with a bumped defaults revision", () => {
    // Load migrates an inherited old default only when the on-disk revision is
    // behind this one. Changing a default without bumping it strands every user
    // who saved a setting on the previous default.
    expect(DEFAULT_CONFIG.providerDefaultsRevision).toBe(2);
  });
});
