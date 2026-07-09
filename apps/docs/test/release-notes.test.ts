import { describe, expect, test } from "bun:test";

import { latestReleaseNotesArtifact, readReleaseNotesArtifacts } from "../lib/release-notes";

describe("release notes artifacts", () => {
  test("loads docs release notes from tracked release artifacts", () => {
    const releases = readReleaseNotesArtifacts();
    const latest = latestReleaseNotesArtifact();

    expect(releases.length).toBeGreaterThan(0);
    expect(latest?.packageName).toBe("@kitsunekode/kunai");
    expect(latest?.install.bunx).toContain("@kitsunekode/kunai@");
    // Artifacts may be summary-only when the changelog has no ### headings
    // (see scripts/generate-release-notes.ts). Prefer sections when present.
    const hasBody =
      (latest?.sections.length ?? 0) > 0 || (latest?.summary.trim().length ?? 0) > 0;
    expect(hasBody).toBe(true);
  });
});
