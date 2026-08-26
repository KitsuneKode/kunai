import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ReleaseDetail } from "../components/releases/release-detail";
import { ReleaseTimeline } from "../components/releases/release-timeline";
import {
  indexableReleaseNotesArtifacts,
  publishedReleaseNotesArtifacts,
  releaseNotesArtifacts,
  withdrawnReleaseNotesArtifacts,
  type ReleaseNotesArtifact,
} from "../lib/release-notes";

/**
 * `withdrawn` is set by the withdraw runbook in
 * `.docs/release-reliability-gate.md`. Step 4 of that runbook names the docs
 * site as a surface a withdrawal must reach, because "a withdrawn version that
 * is withdrawn silently gets reinstalled from a cached tarball, a pinned CI
 * file, or a blog post".
 *
 * Before this, `withdrawn` was a declared status with no reader on the site: the
 * timeline filtered for `published` and `staged`, so a withdrawn release matched
 * neither and vanished from `/releases` entirely, while its detail page still
 * rendered with no badge and an install panel. These tests exist so a real
 * withdrawal — which is rehearsed rarely and executed under pressure — cannot
 * regress back to silence. No tracked artifact is withdrawn today, so the
 * fixture supplies one.
 */
function withdrawnFixture(overrides: Partial<ReleaseNotesArtifact> = {}): ReleaseNotesArtifact {
  return {
    schemaVersion: 2,
    status: "withdrawn",
    publishedAt: "2026-08-20T10:00:00.000Z",
    packageName: "@kitsunekode/kunai",
    version: "9.9.9",
    tag: "v9.9.9",
    title: "Kunai 9.9.9",
    date: null,
    summary: "A release that had to be pulled.",
    sections: [],
    install: {
      npm: "npm install -g @kitsunekode/kunai@9.9.9",
      bunx: "bunx @kitsunekode/kunai@9.9.9",
      binaryLatest: "https://github.com/KitsuneKode/kunai/releases/latest",
    },
    assets: [{ name: "kunai-linux-x64.tar.gz", sha256: "deadbeef" }],
    ...overrides,
  };
}

describe("withdrawn releases", () => {
  test("selectors separate withdrawn from published and from the sitemap", () => {
    expect(publishedReleaseNotesArtifacts().every((r) => r.status === "published")).toBe(true);
    expect(withdrawnReleaseNotesArtifacts().every((r) => r.status === "withdrawn")).toBe(true);
    expect(indexableReleaseNotesArtifacts().some((r) => r.status === "withdrawn")).toBe(false);
    // Nothing is withdrawn today, so indexable is the whole tracked set.
    expect(indexableReleaseNotesArtifacts().length).toBe(releaseNotesArtifacts.length);
  });

  test("the timeline shows a withdrawn release instead of dropping it", () => {
    const published = publishedReleaseNotesArtifacts()[0];
    expect(published).toBeDefined();
    if (!published) return;

    const html = renderToStaticMarkup(
      <ReleaseTimeline releases={[withdrawnFixture(), published]} />,
    );

    expect(html).toContain("Withdrawn");
    expect(html).toContain("v9.9.9");
    expect(html).toContain("kunai rollback");
    // It must never be presented as the current version.
    expect(html).toContain(published.tag);
  });

  test("a withdrawn release is never the latest, even when it is newest", () => {
    const html = renderToStaticMarkup(<ReleaseTimeline releases={[withdrawnFixture()]} />);

    expect(html).toContain("Withdrawn");
    expect(html).not.toContain("Latest");
    expect(html).not.toContain("No release artifacts are available.");
  });

  test("the detail page warns and withholds the install commands", () => {
    const html = renderToStaticMarkup(<ReleaseDetail release={withdrawnFixture()} />);

    expect(html).toContain("Withdrawn");
    expect(html).toContain("kunai rollback");
    // The whole point: no copyable command for the version being warned about.
    expect(html).not.toContain("bunx @kitsunekode/kunai@9.9.9");
    expect(html).not.toContain("npm install -g @kitsunekode/kunai@9.9.9");
    // Checksums stay hidden for anything not published.
    expect(html).not.toContain("deadbeef");
  });

  test("a published release still gets its install panel", () => {
    const published = publishedReleaseNotesArtifacts()[0];
    expect(published).toBeDefined();
    if (!published) return;

    const html = renderToStaticMarkup(<ReleaseDetail release={published} />);

    expect(html).toContain(published.install.bunx);
    expect(html).not.toContain("Withdrawn — do not install");
  });
});
