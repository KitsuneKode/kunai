import { describe, expect, test } from "bun:test";

import { miruroManifest } from "../src/miruro/manifest";
import { providerResearchProfiles } from "../src/research";
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
