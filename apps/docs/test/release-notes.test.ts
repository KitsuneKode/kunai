import { describe, expect, test } from "bun:test";

import {
  displaySectionsForRelease,
  getReleaseByTag,
  githubReleaseTagUrl,
  latestReleaseNotesArtifact,
  normalizeReleaseTag,
  readReleaseNotesArtifacts,
  releasePath,
} from "../lib/release-notes";

describe("release notes artifacts", () => {
  test("loads docs release notes from tracked release artifacts", () => {
    const releases = readReleaseNotesArtifacts();
    const latest = latestReleaseNotesArtifact();

    expect(releases.length).toBeGreaterThan(0);
    expect(latest?.packageName).toBe("@kitsunekode/kunai");
    expect(latest?.install.bunx).toContain("@kitsunekode/kunai@");
    expect(latest?.summary.trim().length).toBeGreaterThan(0);
  });

  test("looks up releases by tag and builds detail paths", () => {
    const releases = readReleaseNotesArtifacts();
    const sample = releases[0];
    expect(sample).toBeDefined();
    if (!sample) return;

    expect(normalizeReleaseTag("0.2.6")).toBe("v0.2.6");
    expect(getReleaseByTag(sample.tag)?.version).toBe(sample.version);
    expect(getReleaseByTag(sample.version)?.tag).toBe(sample.tag);
    expect(releasePath(sample.tag)).toBe(`/releases/${normalizeReleaseTag(sample.tag)}`);
    expect(githubReleaseTagUrl(sample.tag)).toContain(
      `/releases/tag/${normalizeReleaseTag(sample.tag)}`,
    );
  });

  test("derives display sections when artifact sections are empty", () => {
    const emptySections = readReleaseNotesArtifacts().find(
      (release) => release.sections.length === 0,
    );
    expect(emptySections).toBeDefined();
    if (!emptySections) return;

    const derived = displaySectionsForRelease(emptySections);
    expect(derived.length).toBeGreaterThan(0);
    expect(derived[0]?.items.length ?? 0).toBeGreaterThan(0);
  });

  test("keeps explicit sections when present", () => {
    const withSections = readReleaseNotesArtifacts().find((release) => release.sections.length > 0);
    expect(withSections).toBeDefined();
    if (!withSections) return;

    const displayed = displaySectionsForRelease(withSections);
    expect(displayed).toEqual(withSections.sections);
  });
});
