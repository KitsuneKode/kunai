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

  test("mergeKitsuneConfig keeps the base sync section on a null payload", () => {
    // A hand-edited `"sync": {"anilist": null}` previously put null where
    // setup-workflows reads `current.sync.anilist.enabled` — a TypeError on the
    // first run after the edit.
    const merged = mergeKitsuneConfig(DEFAULT_CONFIG, {
      sync: { anilist: null } as never,
    });
    expect(merged.sync.anilist).toEqual(DEFAULT_CONFIG.sync.anilist);
    expect(merged.sync.tmdb).toEqual(DEFAULT_CONFIG.sync.tmdb);
  });

  test("mergeKitsuneConfig survives a fully null sync and merges a partial section", () => {
    const nulled = mergeKitsuneConfig(DEFAULT_CONFIG, { sync: null as never });
    expect(nulled.sync).toEqual(DEFAULT_CONFIG.sync);

    const partial = mergeKitsuneConfig(DEFAULT_CONFIG, {
      sync: { anilist: { enabled: true } } as never,
    });
    expect(partial.sync.anilist.enabled).toBe(true);
    // Keys the partial didn't name keep the base, not undefined.
    expect(partial.sync.anilist.trackWatched).toBe(DEFAULT_CONFIG.sync.anilist.trackWatched);
    expect(partial.sync.tmdb).toEqual(DEFAULT_CONFIG.sync.tmdb);
  });

  test("mergeKitsuneConfig protects the language profiles and youtubeMetadata the same way", () => {
    const merged = mergeKitsuneConfig(DEFAULT_CONFIG, {
      animeLanguageProfile: null as never,
      youtubeMetadata: "junk" as never,
      seriesLanguageProfile: { audio: "ja" } as never,
    });
    expect(merged.animeLanguageProfile).toEqual(DEFAULT_CONFIG.animeLanguageProfile);
    expect(merged.youtubeMetadata).toEqual(DEFAULT_CONFIG.youtubeMetadata);
    expect(merged.seriesLanguageProfile.audio).toBe("ja");
    expect(merged.seriesLanguageProfile.subtitle).toBe(
      DEFAULT_CONFIG.seriesLanguageProfile.subtitle,
    );
  });

  test("defaults put VidLink first in the series automatic lane", () => {
    expect(DEFAULT_CONFIG.provider).toBe("vidlink");
    expect(DEFAULT_CONFIG.providerPriority).toEqual([
      "movy",
      "rivestream",
      "vidrock",
      "videasy",
      "vidbolt",
      "filesun",
    ]);
  });

  test("anime lane leads with a provider that answers and keeps the rest of the order behind it", () => {
    expect(DEFAULT_CONFIG.animeProvider).toBe("hianime");
    // The array holds the rest of the order — `createProviderPrioritySnapshot`
    // prepends the lane default — so it must not repeat it.
    expect(DEFAULT_CONFIG.animeProviderPriority).toEqual([
      "kickassanime",
      "animegg",
      "miruro",
      "allanime",
      "anilight",
      "anidap",
      "animeparadise",
    ]);
    expect(DEFAULT_CONFIG.animeProviderPriority).not.toContain(DEFAULT_CONFIG.animeProvider);
  });

  test("a lane-default change ships with a bumped defaults revision", () => {
    // Load migrates an inherited old default only when the on-disk revision is
    // behind this one. Changing a default without bumping it strands every user
    // who saved a setting on the previous default.
    expect(DEFAULT_CONFIG.providerDefaultsRevision).toBe(11);
  });

  test("no providers are disabled by default", () => {
    expect(DEFAULT_CONFIG.disabledProviders).toEqual([]);
  });
});

test("a malformed providerRelay drops only that key, not the whole config", () => {
  // The whole-file safeParse poison pill: one bad relay value previously
  // discarded every key, silently resetting the user to defaults.
  const parsed = parseKitsuneConfigPartial({
    provider: "vidking",
    animeProvider: "allanime",
    footerHints: "minimal",
    providerRelay: "definitely-not-an-object",
  });
  expect(parsed.provider).toBe("vidking");
  expect(parsed.animeProvider).toBe("allanime");
  expect(parsed.footerHints).toBe("minimal");
  expect(parsed.providerRelay).toBeUndefined();
});

test("a valid providerRelay still parses inside a partial config", () => {
  const parsed = parseKitsuneConfigPartial({
    provider: "vidking",
    providerRelay: {
      baseUrl: "https://relay.example.com",
      providers: { allanime: { enabled: true } },
    },
  });
  expect(parsed.providerRelay?.baseUrl).toBe("https://relay.example.com");
});

test("non-object input still degrades to an empty partial", () => {
  expect(parseKitsuneConfigPartial(null)).toEqual({});
  expect(parseKitsuneConfigPartial("config")).toEqual({});
  expect(parseKitsuneConfigPartial([1, 2])).toEqual({});
});

describe("experimental stremio addons opt-in parse", () => {
  test("absent keys use the defaults: off, no acknowledgement", () => {
    const parsed = parseKitsuneConfigPartial({});
    expect(parsed.experimentalStremioAddons).toBeUndefined();
    expect(DEFAULT_CONFIG.experimentalStremioAddons).toBe(false);
    expect(DEFAULT_CONFIG.stremioAddonsRiskAcknowledgedAt).toBe("");
    expect(mergeKitsuneConfig(DEFAULT_CONFIG, parsed).experimentalStremioAddons).toBe(false);
  });

  test("only strict true turns the flag on; any other truthy value fails closed", () => {
    for (const value of [true, 1, "true", "yes", [true], { on: true }, false, null]) {
      const parsed = parseKitsuneConfigPartial({ experimentalStremioAddons: value });
      expect(parsed.experimentalStremioAddons).toBe(value === true);
    }
  });

  test("the acknowledgement keeps only an ISO timestamp shape", () => {
    const iso = "2026-01-02T03:04:05.006Z";
    expect(
      parseKitsuneConfigPartial({ stremioAddonsRiskAcknowledgedAt: iso })
        .stremioAddonsRiskAcknowledgedAt,
    ).toBe(iso);
    for (const value of [
      "2026-01-02",
      "2026-01-02T03:04:05Z",
      "not a date",
      "2026-13-99T99:99:99.999Z",
      0,
      null,
      true,
    ]) {
      const parsed = parseKitsuneConfigPartial({ stremioAddonsRiskAcknowledgedAt: value });
      expect(parsed.stremioAddonsRiskAcknowledgedAt).toBe("");
    }
  });

  test("malformed opt-in fields never discard unrelated settings", () => {
    const parsed = parseKitsuneConfigPartial({
      experimentalStremioAddons: "yes",
      stremioAddonsRiskAcknowledgedAt: 42,
      provider: "vidlink",
      stremioAddons: [{ url: "https://a.example.com/manifest.json" }],
    });
    expect(parsed).toMatchObject({
      experimentalStremioAddons: false,
      stremioAddonsRiskAcknowledgedAt: "",
      provider: "vidlink",
      stremioAddons: [{ url: "https://a.example.com/manifest.json" }],
    });
  });

  test("mergeKitsuneConfig normalizes both fields", () => {
    const merged = mergeKitsuneConfig(
      DEFAULT_CONFIG,
      // Malformed values on purpose — merge must normalize them.
      JSON.parse(
        '{"experimentalStremioAddons":"yes","stremioAddonsRiskAcknowledgedAt":"tomorrow"}',
      ),
    );
    expect(merged.experimentalStremioAddons).toBe(false);
    expect(merged.stremioAddonsRiskAcknowledgedAt).toBe("");

    const on = mergeKitsuneConfig(DEFAULT_CONFIG, {
      experimentalStremioAddons: true,
      stremioAddonsRiskAcknowledgedAt: "2026-01-02T03:04:05.006Z",
    });
    expect(on.experimentalStremioAddons).toBe(true);
    expect(on.stremioAddonsRiskAcknowledgedAt).toBe("2026-01-02T03:04:05.006Z");
  });
});
