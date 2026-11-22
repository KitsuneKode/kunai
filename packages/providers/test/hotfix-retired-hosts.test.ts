import { afterEach, describe, expect, test } from "bun:test";

import { effectiveAnimeggBaseUrl } from "../src/animegg/site";
import { effectiveHianimeBase } from "../src/hianime/parsers";
import { effectiveMovyApiBase } from "../src/movy/direct";
import { effectiveRivestreamScraperBase } from "../src/rivestream/direct";
import {
  ProviderHostsRetiredError,
  requireEffectiveProviderHost,
  setActiveProviderHotfixManifest,
} from "../src/shared/hotfix-runtime";
import type { ProviderHotfixManifest } from "../src/shared/manifest-bundle";
import { effectiveVidlinkApiBase } from "../src/vidlink/direct";
import { effectiveVidrockApiBase } from "../src/vidrock/direct";

function manifest(providers: ProviderHotfixManifest["providers"]): ProviderHotfixManifest {
  const now = Date.now();
  return {
    schemaVersion: 1,
    revision: 1,
    generatedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
    providers,
  };
}

afterEach(() => setActiveProviderHotfixManifest(null));

describe("deadServers can retire a provider's only host", () => {
  test("the helper returns the surviving host, or throws when none survive", () => {
    expect(requireEffectiveProviderHost("x", ["https://a.example"])).toBe("https://a.example");

    setActiveProviderHotfixManifest(
      manifest({ x: { deadServers: ["https://a.example"], mirrors: ["https://b.example"] } }),
    );
    expect(requireEffectiveProviderHost("x", ["https://a.example"])).toBe("https://b.example");

    setActiveProviderHotfixManifest(manifest({ x: { deadServers: ["https://a.example/"] } }));
    expect(() => requireEffectiveProviderHost("x", ["https://a.example"])).toThrow(
      ProviderHostsRetiredError,
    );
  });

  // Each single-host adapter used to fall back to the bundled host here,
  // sending traffic to the exact server the manifest had retired.
  for (const [providerId, bundled, effective] of [
    ["movy", effectiveMovyApiBase(), effectiveMovyApiBase],
    ["vidrock", effectiveVidrockApiBase(), effectiveVidrockApiBase],
    ["hianime", effectiveHianimeBase(), effectiveHianimeBase],
    ["animegg", effectiveAnimeggBaseUrl(), effectiveAnimeggBaseUrl],
    ["rivestream", effectiveRivestreamScraperBase(), effectiveRivestreamScraperBase],
    ["vidlink", effectiveVidlinkApiBase(), effectiveVidlinkApiBase],
  ] as const) {
    test(`${providerId}: retiring the bundled host fails fast instead of calling it`, () => {
      setActiveProviderHotfixManifest(manifest({ [providerId]: { deadServers: [bundled] } }));
      expect(() => effective()).toThrow(ProviderHostsRetiredError);
    });
  }
});
