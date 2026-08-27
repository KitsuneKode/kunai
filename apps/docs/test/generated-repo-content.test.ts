import { describe, expect, test } from "bun:test";

import generatedMascot from "../lib/generated-mascot.json";
import { releaseNotesArtifacts } from "../lib/release-notes";
import { troubleshootingFaqEntries } from "../lib/troubleshooting-faq";
import { buildRepoContent, repoContentIdentity } from "../scripts/sync-repo-content";

/**
 * `.release/`, `docs/`, and the OG mascot are baked into `lib/generated-*.json`
 * at build time so the runtime bundle touches no filesystem. Nothing at request
 * time would notice a stale bake, so it has to fail here.
 * `scripts/check-codegen-freshness.ts` asks the same question in CI.
 */
describe("generated repo content", () => {
  const fresh = buildRepoContent();

  test("release notes match .release/", () => {
    expect(repoContentIdentity(releaseNotesArtifacts)).toBe(
      repoContentIdentity(fresh.releaseNotes),
    );
  });

  test("troubleshooting FAQ matches docs/", () => {
    expect(repoContentIdentity(troubleshootingFaqEntries)).toBe(
      repoContentIdentity(fresh.troubleshootingFaq),
    );
  });

  test("OG mascot matches the tracked PNG", () => {
    expect(generatedMascot.mascotDataUrl).toBe(fresh.mascot.mascotDataUrl);
    expect(generatedMascot.mascotDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    // Bounded on both sides. The lower bound proves the illustrated still baked
    // rather than an empty read; the upper bound is the point of the exercise —
    // this string is inlined into two OG route bundles, and the previous guard
    // asserted it was *large*, which locked a 137 KB inline in place.
    expect(generatedMascot.mascotDataUrl.length).toBeGreaterThan(2_000);
    expect(generatedMascot.mascotDataUrl.length).toBeLessThan(40_000);
  });
});
