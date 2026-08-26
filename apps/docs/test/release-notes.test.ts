import { describe, expect, test } from "bun:test";

import {
  displaySectionsForRelease,
  getReleaseByTag,
  githubReleaseTagUrl,
  githubReleaseUrl,
  latestReleaseNotesArtifact,
  normalizeReleaseTag,
  publishedReleaseNotesArtifacts,
  releaseNotesArtifacts,
  releaseAssetsForDisplay,
  releasePath,
  type ReleaseNotesArtifact,
} from "../lib/release-notes";

describe("release notes artifacts", () => {
  test("loads docs release notes from tracked release artifacts", () => {
    const releases = releaseNotesArtifacts;
    const latest = latestReleaseNotesArtifact();

    expect(releases.length).toBeGreaterThan(0);
    expect(latest?.packageName).toBe("@kitsunekode/kunai");
    expect(latest?.install.bunx).toContain("@kitsunekode/kunai@");
    expect(latest?.summary.trim().length).toBeGreaterThan(0);
  });

  test("latest public release ignores the staged candidate", () => {
    expect(latestReleaseNotesArtifact()?.version).toBe("0.2.5");
    expect(
      publishedReleaseNotesArtifacts().every((release) => release.status === "published"),
    ).toBe(true);
    expect(publishedReleaseNotesArtifacts().some((release) => release.version === "0.3.0")).toBe(
      false,
    );
  });

  /**
   * The published line is 0.2.5 → 0.3.0. The old `0.2.6` artifact was removed:
   * that cycle was versioned but never published (the release workflow could not
   * find its own composite action), and its work reaches users for the first
   * time inside 0.3.0, where the changelog folds it in. Shipping a standalone
   * 0.2.6 entry would advertise a version that has no tag, no binaries, and no
   * npm release.
   */
  test("no release artifact sits between 0.2.5 and 0.3.0", () => {
    expect(getReleaseByTag("0.2.6")).toBeNull();
    expect(releaseNotesArtifacts.map((release) => release.version)).toEqual(["0.3.0", "0.2.5"]);
  });

  test("staged releases have no GitHub URL or visible assets", () => {
    const staged = getReleaseByTag("0.3.0");
    expect(staged).toBeDefined();
    if (!staged) return;

    expect(staged.status).toBe("staged");
    expect(githubReleaseUrl(staged)).toBeNull();
    expect(releaseAssetsForDisplay(staged)).toEqual([]);
  });

  test("looks up releases by tag and builds detail paths", () => {
    const releases = releaseNotesArtifacts;
    const sample = releases[0];
    expect(sample).toBeDefined();
    if (!sample) return;

    expect(normalizeReleaseTag("0.2.5")).toBe("v0.2.5");
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
    const withSections = releaseNotesArtifacts.find((release) => release.sections.length > 0);
    expect(withSections).toBeDefined();
    if (!withSections) return;

    const displayed = displaySectionsForRelease(withSections);
    expect(displayed).toEqual(withSections.sections);
  });
});
