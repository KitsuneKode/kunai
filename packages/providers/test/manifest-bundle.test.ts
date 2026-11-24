import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

import {
  ALLMANGA_BOOTSTRAP_URL,
  ALLMANGA_CRYPTO_PROFILE,
  getEffectiveAllMangaBootstrapUrl,
  getEffectiveAllMangaCryptoProfile,
  getEffectiveAllMangaQueryHash,
} from "../src/allmanga/crypto";
import { ANIMEGG_BASE_URL, effectiveAnimeggBaseUrl } from "../src/animegg/site";
import {
  effectiveHianimeBase,
  effectiveHianimeReferer,
  HIANIME_BASE,
} from "../src/hianime/parsers";
import { effectiveKaaBase } from "../src/kickassanime/direct";
import { miruroPipeBaseUrls } from "../src/miruro/mirrors";
import { effectiveMovyApiBase, MOVY_API_BASE } from "../src/movy/direct";
import {
  effectiveRivestreamReferer,
  effectiveRivestreamScraperBase,
  RIVESTREAM_REFERER,
  RIVESTREAM_SCRAPER_BASE,
} from "../src/rivestream/direct";
import { setActiveProviderHotfixManifest } from "../src/shared/hotfix-runtime";
import {
  canonicalizeManifestPayload,
  isSafeManifestHttpsUrl,
  mergeProviderMirrors,
  resolveProviderHotfixEntry,
  signProviderManifest,
  verifySignedProviderManifest,
  type ProviderHotfixManifest,
} from "../src/shared/manifest-bundle";
import { effectiveWingsApiBases, WINGS_API_BASE } from "../src/videasy/direct";
import {
  effectiveVidlinkApiBase,
  effectiveVidlinkEncDecBase,
  effectiveVidlinkOrigin,
} from "../src/vidlink/direct";
import {
  effectiveVidrockApiBase,
  effectiveVidrockKeyHex,
  VIDROCK_KEY_HEX,
} from "../src/vidrock/direct";

afterEach(() => {
  setActiveProviderHotfixManifest(null);
});

const NOW_MS = Date.parse("2026-11-22T00:00:00Z");

function makeKeypair() {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function sampleManifest(overrides?: Partial<ProviderHotfixManifest>): ProviderHotfixManifest {
  return {
    schemaVersion: 1,
    revision: 42,
    generatedAt: "2026-11-21T12:00:00Z",
    expiresAt: "2026-12-21T12:00:00Z",
    lanePriorities: {
      series: ["movy", "vidrock", "vidlink"],
      anime: ["hianime", "kickassanime", "animegg"],
    },
    providers: {
      allanime: {
        cryptoOverrides: {
          buildId: "189",
        },
      },
      rivestream: {
        baseUrl: "https://scrapper.rivestream.app",
        mirrors: ["https://rivestream.org"],
        deadServers: ["https://old-dead.example"],
      },
    },
    ...overrides,
  };
}

describe("signed hot-update provider manifest bundle", () => {
  test("verifies a valid Ed25519 signed manifest and resolves overrides", () => {
    const { publicKey, privateKey } = makeKeypair();
    const manifest = sampleManifest();
    const envelope = signProviderManifest(manifest, privateKey, "kunai-prod-2026");

    const verified = verifySignedProviderManifest(
      envelope,
      { "kunai-prod-2026": publicKey },
      NOW_MS,
    );

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.manifest.revision).toBe(42);
    expect(
      resolveProviderHotfixEntry(verified.manifest, "allanime")?.cryptoOverrides?.buildId,
    ).toBe("189");
  });

  test("fails closed when the manifest payload is tampered after signing", () => {
    const { publicKey, privateKey } = makeKeypair();
    const envelope = signProviderManifest(sampleManifest(), privateKey, "kunai-prod-2026");
    const tampered = {
      ...envelope,
      manifest: {
        ...envelope.manifest,
        providers: {
          ...envelope.manifest.providers,
          rivestream: { baseUrl: "https://evil.example" },
        },
      },
    };

    const verified = verifySignedProviderManifest(
      tampered,
      { "kunai-prod-2026": publicKey },
      NOW_MS,
    );

    expect(verified.ok).toBe(false);
  });

  test("fails closed on untrusted keyId, wrong key, or expired manifest", () => {
    const pairA = makeKeypair();
    const pairB = makeKeypair();
    const envelope = signProviderManifest(sampleManifest(), pairA.privateKey, "kunai-prod-2026");

    expect(
      verifySignedProviderManifest(envelope, { "other-key": pairA.publicKey }, NOW_MS).ok,
    ).toBe(false);
    expect(
      verifySignedProviderManifest(envelope, { "kunai-prod-2026": pairB.publicKey }, NOW_MS).ok,
    ).toBe(false);

    const expired = signProviderManifest(
      sampleManifest({ expiresAt: "2026-11-01T00:00:00Z" }),
      pairA.privateKey,
      "kunai-prod-2026",
    );
    expect(
      verifySignedProviderManifest(expired, { "kunai-prod-2026": pairA.publicKey }, NOW_MS).ok,
    ).toBe(false);
  });

  test("canonicalizes payload deterministically regardless of key order", () => {
    const a = sampleManifest();
    const b: ProviderHotfixManifest = {
      providers: a.providers,
      expiresAt: a.expiresAt,
      generatedAt: a.generatedAt,
      revision: a.revision,
      schemaVersion: 1,
      lanePriorities: a.lanePriorities,
    };

    expect(
      Buffer.from(canonicalizeManifestPayload(a)).equals(
        Buffer.from(canonicalizeManifestPayload(b)),
      ),
    ).toBe(true);
  });

  test("mergeProviderMirrors prioritizes hotfix hosts, deduplicates, and filters dead servers", () => {
    const hotfix = resolveProviderHotfixEntry(sampleManifest(), "rivestream");
    const merged = mergeProviderMirrors(
      ["https://old-dead.example/", "https://rivestream.org", "https://fallback.example"],
      hotfix,
    );

    expect(merged).toEqual([
      "https://scrapper.rivestream.app",
      "https://rivestream.org",
      "https://fallback.example",
    ]);
  });

  test("rejects cleartext http, private IPv4/IPv6 mirrors, overlong lifetimes, future timestamps, and prototype-pollution keys while allowing fc*/fd* public DNS names", () => {
    const { publicKey, privateKey } = makeKeypair();
    const keys = { "kunai-prod-2026": publicKey };

    const fcDomainMirror = signProviderManifest(
      sampleManifest({
        providers: {
          rivestream: {
            baseUrl: "https://fcdn.example/api",
            mirrors: ["https://fdroid-mirror.example"],
          },
        },
      }),
      privateKey,
      "kunai-prod-2026",
    );
    expect(verifySignedProviderManifest(fcDomainMirror, keys, NOW_MS).ok).toBe(true);

    const mappedIpv6Loopback = signProviderManifest(
      sampleManifest({
        providers: { rivestream: { baseUrl: "https://[::ffff:127.0.0.1]/evil" } },
      }),
      privateKey,
      "kunai-prod-2026",
    );
    expect(verifySignedProviderManifest(mappedIpv6Loopback, keys, NOW_MS).ok).toBe(false);

    const httpMirror = signProviderManifest(
      sampleManifest({ providers: { rivestream: { baseUrl: "http://rivestream.org" } } }),
      privateKey,
      "kunai-prod-2026",
    );
    expect(verifySignedProviderManifest(httpMirror, keys, NOW_MS).ok).toBe(false);

    const loopbackMirror = signProviderManifest(
      sampleManifest({ providers: { rivestream: { mirrors: ["https://127.0.0.1/evil"] } } }),
      privateKey,
      "kunai-prod-2026",
    );
    expect(verifySignedProviderManifest(loopbackMirror, keys, NOW_MS).ok).toBe(false);

    const tooLongLifetime = signProviderManifest(
      sampleManifest({ expiresAt: "2028-01-01T00:00:00Z" }),
      privateKey,
      "kunai-prod-2026",
    );
    expect(verifySignedProviderManifest(tooLongLifetime, keys, NOW_MS).ok).toBe(false);

    const futureDated = signProviderManifest(
      sampleManifest({ generatedAt: "2026-11-23T00:00:00Z" }),
      privateKey,
      "kunai-prod-2026",
    );
    expect(verifySignedProviderManifest(futureDated, keys, NOW_MS).ok).toBe(false);

    const badKeyId = signProviderManifest(sampleManifest(), privateKey, "key\u001b[31m");
    expect(verifySignedProviderManifest(badKeyId, keys, NOW_MS).ok).toBe(false);

    const badProviderKey = signProviderManifest(
      sampleManifest({ providers: { constructor: { disabled: true } } }),
      privateKey,
      "kunai-prod-2026",
    );
    expect(verifySignedProviderManifest(badProviderKey, keys, NOW_MS).ok).toBe(false);
  });

  test("hotfix runtime overrides Rivestream host and AllManga rotation profile atomically", () => {
    expect(effectiveRivestreamScraperBase()).toBe(RIVESTREAM_SCRAPER_BASE);
    expect(effectiveRivestreamReferer()).toBe(RIVESTREAM_REFERER);
    expect(getEffectiveAllMangaCryptoProfile()).toEqual(ALLMANGA_CRYPTO_PROFILE);

    // Partial AllManga override must fall back atomically to bundled profile.
    setActiveProviderHotfixManifest(
      sampleManifest({
        providers: {
          rivestream: { baseUrl: "https://mirror.rivestream.test/proxy" },
          allanime: { cryptoOverrides: { buildId: "199", queryHash: "abcd1234" } },
        },
      }),
    );
    expect(effectiveRivestreamScraperBase()).toBe("https://mirror.rivestream.test/proxy");
    // Referer stays on the site origin unless explicitly overridden via cryptoOverrides.referer.
    expect(effectiveRivestreamReferer()).toBe(RIVESTREAM_REFERER);
    expect(getEffectiveAllMangaCryptoProfile()).toEqual(ALLMANGA_CRYPTO_PROFILE);
    expect(getEffectiveAllMangaQueryHash()).toBe("abcd1234");

    setActiveProviderHotfixManifest(
      sampleManifest({
        providers: {
          rivestream: {
            baseUrl: "https://mirror.rivestream.test",
            cryptoOverrides: { referer: "https://alt-site.rivestream.test/" },
          },
        },
      }),
    );
    expect(effectiveRivestreamReferer()).toBe("https://alt-site.rivestream.test/");

    // Insecure http:// bootstrapUrl override must be rejected in favor of bundled HTTPS URL.
    setActiveProviderHotfixManifest(
      sampleManifest({
        providers: {
          allanime: { cryptoOverrides: { bootstrapUrl: "http://127.0.0.1/bootstrap" } },
        },
      }),
    );
    expect(getEffectiveAllMangaBootstrapUrl()).toBe(ALLMANGA_BOOTSTRAP_URL);

    // Complete AllManga rotation profile applies atomically.
    setActiveProviderHotfixManifest(
      sampleManifest({
        providers: {
          allanime: {
            cryptoOverrides: {
              buildId: "199",
              saltMul: "17",
              saltAdd: "23",
              fragMul: "11",
              fragAdd: "3",
              bootPrefix: "NEWPRE:",
              bootJoin: "|",
              bootParts: "group,host,lane,buildId,epoch",
              maskFragments: "AAAAAAAAAAA=,BBBBBBBBBBB=,CCCCCCCCCCC=,DDDDDDDDDDD=",
              queryHash: "deadbeef",
            },
          },
        },
      }),
    );
    const active = getEffectiveAllMangaCryptoProfile();
    expect(active.buildId).toBe("199");
    expect(active.saltMul).toBe(17);
    expect(active.bootJoin).toBe("|");
    expect(active.bootParts).toEqual(["group", "host", "lane", "buildId", "epoch"]);
    expect(getEffectiveAllMangaQueryHash()).toBe("deadbeef");

    setActiveProviderHotfixManifest(null);
    expect(effectiveRivestreamScraperBase()).toBe(RIVESTREAM_SCRAPER_BASE);
    expect(effectiveRivestreamReferer()).toBe(RIVESTREAM_REFERER);
    expect(getEffectiveAllMangaCryptoProfile()).toEqual(ALLMANGA_CRYPTO_PROFILE);
  });

  test("hotfix runtime overrides mirrors and crypto across all direct-domain providers", () => {
    const newVidrockKey = "a".repeat(64);
    setActiveProviderHotfixManifest(
      sampleManifest({
        providers: {
          vidlink: {
            baseUrl: "https://vidlink.alt.test",
            cryptoOverrides: { encDecBase: "https://enc.alt.test/api" },
          },
          vidrock: {
            baseUrl: "https://vidrock.alt.test",
            cryptoOverrides: { keyHex: newVidrockKey },
          },
          movy: { baseUrl: "https://api.movy.alt.test" },
          videasy: { baseUrl: "https://wings.alt.test" },
          hianime: { baseUrl: "https://hianime.alt.test" },
          animegg: { baseUrl: "https://animegg.alt.test" },
          kickassanime: { baseUrl: "https://kaa.alt.test" },
          miruro: { baseUrl: "https://www.miruro.alt.test" },
        },
      }),
    );

    expect(effectiveVidlinkApiBase()).toBe("https://vidlink.alt.test/api/b");
    expect(effectiveVidlinkOrigin()).toBe("https://vidlink.alt.test");
    expect(effectiveVidlinkEncDecBase()).toBe("https://enc.alt.test/api");

    // A baseUrl ending in /api must normalize to /api/b, not /api/api/b.
    setActiveProviderHotfixManifest(
      sampleManifest({
        providers: { vidlink: { baseUrl: "https://vidlink.alt.test/api" } },
      }),
    );
    expect(effectiveVidlinkApiBase()).toBe("https://vidlink.alt.test/api/b");

    setActiveProviderHotfixManifest(
      sampleManifest({
        providers: {
          vidlink: {
            baseUrl: "https://vidlink.alt.test",
            cryptoOverrides: { encDecBase: "https://enc.alt.test/api" },
          },
          vidrock: {
            baseUrl: "https://vidrock.alt.test",
            cryptoOverrides: { keyHex: newVidrockKey },
          },
          movy: { baseUrl: "https://api.movy.alt.test" },
          videasy: { baseUrl: "https://wings.alt.test" },
          hianime: { baseUrl: "https://hianime.alt.test" },
          animegg: { baseUrl: "https://animegg.alt.test" },
          kickassanime: { baseUrl: "https://kaa.alt.test" },
          miruro: { baseUrl: "https://www.miruro.alt.test" },
        },
      }),
    );
    expect(effectiveVidrockApiBase()).toBe("https://vidrock.alt.test/api");
    expect(effectiveVidrockKeyHex()).toBe(newVidrockKey);
    expect(effectiveMovyApiBase()).toBe("https://api.movy.alt.test");
    expect(effectiveWingsApiBases()[0]).toBe("https://wings.alt.test");
    expect(effectiveHianimeBase()).toBe("https://hianime.alt.test");
    expect(effectiveHianimeReferer()).toBe("https://hianime.alt.test/");
    expect(effectiveAnimeggBaseUrl()).toBe("https://animegg.alt.test");
    expect(effectiveKaaBase()).toBe("https://kaa.alt.test");
    expect(
      miruroPipeBaseUrls({ fetchImpl: async () => new Response("{}", { status: 500 }) })[0],
    ).toBe("https://www.miruro.alt.test");

    setActiveProviderHotfixManifest(null);
    expect(effectiveVidrockKeyHex()).toBe(VIDROCK_KEY_HEX);
    expect(effectiveMovyApiBase()).toBe(MOVY_API_BASE);
    expect(effectiveWingsApiBases()[0]).toBe(WINGS_API_BASE);
    expect(effectiveHianimeBase()).toBe(HIANIME_BASE);
    expect(effectiveAnimeggBaseUrl()).toBe(ANIMEGG_BASE_URL);
  });

  test("isSafeManifestHttpsUrl rejects local, intranet, NAT64, multicast, and broadcast targets", () => {
    for (const bad of [
      "https://metadata/",
      "https://service.internal/api",
      "https://printer.local/api",
      "https://router.home.arpa/api",
      "https://localhost./api",
      "https://[64:ff9b::7f00:1]/api",
      "https://[fe90::1]/api",
      "https://[ff02::1]/api",
      "https://224.0.0.1/api",
      "https://255.255.255.255/api",
    ]) {
      expect(isSafeManifestHttpsUrl(bad)).toBe(false);
    }
    expect(isSafeManifestHttpsUrl("https://mirror.example/api")).toBe(true);
  });
});
