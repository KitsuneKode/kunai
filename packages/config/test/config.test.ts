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
    expect(DEFAULT_CONFIG.providerPriority).toEqual(["rivestream", "vidrock", "movy", "videasy"]);
  });

  test("anime lane leads with a provider that answers and keeps the rest of the order behind it", () => {
    // HiAnime leads because search only queries the configured default.
    // KickAssAnime leads the rest (own stack, soft subs); AllAnime precedes
    // the dead pair — Miruro's pipe route is gone from their bundle and
    // AniDB was retired from production when anidb.app began redirecting away
    // from the old origin (2026-10-24); Miruro stays at the tail for revival.
    expect(DEFAULT_CONFIG.animeProvider).toBe("hianime");
    // The array holds the rest of the order — `createProviderPrioritySnapshot`
    // prepends the lane default — so it must not repeat it.
    expect(DEFAULT_CONFIG.animeProviderPriority).toEqual([
      "kickassanime",
      "animegg",
      "allanime",
      "miruro",
    ]);
    expect(DEFAULT_CONFIG.animeProviderPriority).not.toContain(DEFAULT_CONFIG.animeProvider);
  });

  test("a lane-default change ships with a bumped defaults revision", () => {
    // Load migrates an inherited old default only when the on-disk revision is
    // behind this one. Changing a default without bumping it strands every user
    // who saved a setting on the previous default.
    expect(DEFAULT_CONFIG.providerDefaultsRevision).toBe(6);
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
