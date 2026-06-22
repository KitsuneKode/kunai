import { describe, expect, test } from "bun:test";

import { latestReleaseNotesArtifact, readReleaseNotesArtifacts } from "../lib/release-notes";

describe("release notes artifacts", () => {
  test("loads docs release notes from tracked release artifacts", () => {
    const releases = readReleaseNotesArtifacts();
    const latest = latestReleaseNotesArtifact();

    expect(releases.length).toBeGreaterThan(0);
    expect(latest?.packageName).toBe("@kitsunekode/kunai");
    expect(latest?.install.bunx).toContain("@kitsunekode/kunai@");
    expect(latest?.sections.length).toBeGreaterThan(0);
  });
});
