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
   * The published line is contiguous: 0.2.5 then 0.3.0.
   *
   * A cycle between them was versioned and had notes written, but the release
   * workflow could not find its own composite action, so it produced no tag, no
   * binaries, and no npm release. Its work was folded into 0.3.0. Keeping a
   * standalone artifact for it would advertise a version nobody can install, so
   * this pins that no such gap reappears.
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

  test("keeps explicit sections, in order, without re-deriving them", () => {
    const withSections = releaseNotesArtifacts.find((release) => release.sections.length > 0);
    expect(withSections).toBeDefined();
    if (!withSections) return;

    const displayed = displaySectionsForRelease(withSections);
    // Every explicit section survives untouched and in order. A summary the
    // sections do not cover is prepended as Overview rather than dropped, so the
    // displayed list is the explicit sections optionally preceded by one entry.
    const tail = displayed.slice(displayed.length - withSections.sections.length);
    expect(tail.length).toBe(withSections.sections.length);
    withSections.sections.forEach((section, index) => {
      expect(tail[index]).toEqual(section);
    });
    const extra = displayed.slice(0, displayed.length - withSections.sections.length);
    expect(extra.length).toBeLessThanOrEqual(1);
    for (const section of extra) {
      expect(section.title).toBe("Overview");
      expect(section.body).toBe(withSections.summary.trim());
    }
  });
});

test("an artifact whose only heading is trailing still shows the text above it", () => {
  // 0.3.0 carries a single `### Privacy` at the end, so everything else lives in
  // `summary`. Returning explicit sections alone rendered the release page as the
  // Privacy list and nothing else.
  const sections = displaySectionsForRelease({
    version: "0.3.0",
    tag: "v0.3.0",
    title: "Kunai 0.3.0",
    date: null,
    summary: "Lead paragraph.\n\n- first bullet",
    changelogBody: "Lead paragraph.\n\n- first bullet\n\n### Privacy\n\n- privacy bullet",
    sections: [{ title: "Privacy", body: "- privacy bullet", items: ["privacy bullet"] }],
  } as never);

  expect(sections.map((section) => section.title)).toEqual(["Overview", "Privacy"]);
  expect(sections[0]?.items).toContain("first bullet");
});

test("a summary already represented by a section is not duplicated", () => {
  const sections = displaySectionsForRelease({
    version: "0.3.0",
    tag: "v0.3.0",
    title: "Kunai 0.3.0",
    date: null,
    summary: "",
    changelogBody: "### Privacy\n\n- privacy bullet",
    sections: [{ title: "Privacy", body: "- privacy bullet", items: ["privacy bullet"] }],
  } as never);

  expect(sections.map((section) => section.title)).toEqual(["Privacy"]);
});
