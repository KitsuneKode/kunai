import { describe, expect, test } from "bun:test";

import { miruroManifest } from "../src/miruro/manifest";
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
