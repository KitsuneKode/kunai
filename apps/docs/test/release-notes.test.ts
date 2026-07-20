import { describe, expect, test } from "bun:test";

import {
  displaySectionsForRelease,
  getReleaseByTag,
  githubReleaseTagUrl,
  githubReleaseUrl,
  latestReleaseNotesArtifact,
  normalizeReleaseTag,
  publishedReleaseNotesArtifacts,
  readReleaseNotesArtifacts,
  releaseAssetsForDisplay,
  releasePath,
  type ReleaseNotesArtifact,
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

  test("latest public release ignores staged 0.2.6", () => {
    expect(latestReleaseNotesArtifact()?.version).toBe("0.2.5");
    expect(
      publishedReleaseNotesArtifacts().every((release) => release.status === "published"),
    ).toBe(true);
    expect(publishedReleaseNotesArtifacts().some((release) => release.version === "0.2.6")).toBe(
      false,
    );
  });

  test("staged releases have no GitHub URL or visible assets", () => {
    const STAGED_026 = getReleaseByTag("0.2.6");
    expect(STAGED_026).toBeDefined();
    if (!STAGED_026) return;

    expect(STAGED_026.status).toBe("staged");
    expect(githubReleaseUrl(STAGED_026)).toBeNull();
    expect(releaseAssetsForDisplay(STAGED_026)).toEqual([]);
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
    const emptySections: ReleaseNotesArtifact = {
      schemaVersion: 2,
      status: "published",
      publishedAt: "2026-01-01T00:00:00Z",
      packageName: "@kitsunekode/kunai",
      version: "0.0.0",
      tag: "v0.0.0",
      title: "Kunai 0.0.0",
      date: null,
      summary: "Lead paragraph.\n\n### Highlights\n\n- First item\n- Second item",
      sections: [],
      changelogBody: "Lead paragraph.\n\n### Highlights\n\n- First item\n- Second item",
      install: {
        npm: "npm install -g @kitsunekode/kunai@0.0.0",
        bunx: "bunx @kitsunekode/kunai@0.0.0",
        binaryLatest: "https://github.com/KitsuneKode/kunai/releases/latest",
      },
    };

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
