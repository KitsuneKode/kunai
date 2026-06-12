import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLAYBACK_PHASE_PATH = join(import.meta.dir, "../../../src/app/PlaybackPhase.ts");

describe("PlaybackPhase post-play provider fallback boundary", () => {
  test("captures the original provider before mutating resolvedProviderId", () => {
    const source = readFileSync(PLAYBACK_PHASE_PATH, "utf8");
    const branchStart = source.indexOf('} else if (routedAction === "fallback") {');
    expect(branchStart).toBeGreaterThan(-1);
    const branchEnd = source.indexOf(
      '} else if (\n              routedAction === "provider"',
      branchStart,
    );
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = source.slice(branchStart, branchEnd);

    expect(branch.indexOf("const switched = await switchPlaybackProviderFallback")).toBeLessThan(
      branch.indexOf("resolvedProviderId = switched.providerId"),
    );
    expect(branch).toContain("fromProviderId: resolvedProviderId");
    expect(branch).toContain("fromProvider: switched.fromProviderId");
    expect(branch).toContain("from: switched.fromProviderId");
  });
});
