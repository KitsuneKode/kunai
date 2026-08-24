import { describe, expect, test } from "bun:test";

import { allanimeManifest } from "../src/allmanga/manifest";
import { anidbManifest } from "../src/anidb/manifest";
import { miruroManifest } from "../src/miruro/manifest";
import { providerResearchProfiles } from "../src/research";
import { rivestreamManifest } from "../src/rivestream/manifest";
import { videasyManifest } from "../src/videasy/manifest";
import { vidlinkManifest } from "../src/vidlink/manifest";
import { youtubeManifest } from "../src/youtube/manifest";

/**
 * Manifests here understated what the code does, which is the failure mode
 * nobody notices: a capability that is implemented but undeclared reads as
 * absent to every human and to any future capability-based routing.
 */

describe("manifests describe what the code does", () => {
  test("youtube declares subtitle resolution, which it implements", () => {
    // youtube/direct.ts builds SubtitleCandidate[] and returns them.
    expect(youtubeManifest.capabilities).toContain("subtitle-resolve");
  });

  test("miruro declares subtitle resolution, which it implements", () => {
    // miruro/direct.ts maps pipe subtitles into SubtitleCandidate[].
    expect(miruroManifest.capabilities).toContain("subtitle-resolve");
  });

  test("declaring a capability does not drop the existing ones", () => {
    expect(youtubeManifest.capabilities).toContain("source-resolve");
    expect(miruroManifest.capabilities).toContain("multi-source");
  });
});

/**
 * Cache keyParts are load-bearing: `stream-resolve-cache.ts` reads them verbatim
 * to build the resolve cache key. A stream-resolve provider that omits a
 * preference token reuses one cached entry across different requests for that
 * preference, so switching audio, subtitle, or quality can serve a stream that
 * answers the previous choice until the TTL expires — a correctness bug, not a
 * perf one. Over-keying is safe (a redundant re-resolve); under-keying is not,
 * so every stream-resolve provider must carry the whole preference set.
 */
describe("resolve cache keyParts cannot silently drift", () => {
  const PREFERENCE_TOKENS = [
    "audio",
    "subtitle",
    "quality",
    "startup",
    "source",
    "stream",
  ] as const;

  const streamResolveManifests = [
    { name: "vidlink", manifest: vidlinkManifest },
    { name: "videasy", manifest: videasyManifest },
    { name: "rivestream", manifest: rivestreamManifest },
    { name: "miruro", manifest: miruroManifest },
    { name: "anidb", manifest: anidbManifest },
    { name: "allmanga", manifest: allanimeManifest },
  ];

  for (const { name, manifest } of streamResolveManifests) {
    test(`${name} keys on every request preference`, () => {
      expect(manifest.capabilities).toContain("source-resolve");
      const keyParts = manifest.cachePolicy.keyParts;
      for (const token of PREFERENCE_TOKENS) {
        expect(keyParts).toContain(token);
      }
    });

    test(`${name} keys on provider identity and the episode coordinate`, () => {
      const keyParts = manifest.cachePolicy.keyParts;
      expect(keyParts).toContain("provider");
      expect(keyParts).toContain(manifest.id);
      expect(keyParts).toContain("title");
      expect(keyParts).toContain("episode");
    });
  }
});

describe("research profiles match the production registry", () => {
  test("providers wired into the runtime registry are not marked candidate", () => {
    // Both are constructed in apps/cli/src/container/bootstrap-providers.ts.
    for (const providerId of ["miruro", "rivestream"]) {
      const profile = providerResearchProfiles.find(
        (candidate) => candidate.providerId === providerId,
      );
      expect(profile?.status).toBe("production");
    }
  });

  test("a shipped provider is not still queued for implementation", () => {
    for (const providerId of ["miruro", "rivestream"]) {
      const profile = providerResearchProfiles.find(
        (candidate) => candidate.providerId === providerId,
      );
      expect(profile?.migrationAction).not.toBe("implement-from-scratchpad");
    }
  });
});
