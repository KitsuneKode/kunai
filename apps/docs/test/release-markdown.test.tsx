import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ReleaseDetail } from "../components/releases/release-detail";
import { MarkdownText } from "../components/shared/markdown-text";
import { releaseNotesArtifacts, type ReleaseNotesArtifact } from "../lib/release-notes";

/**
 * Release notes regressed once already: `release-sections.tsx` interpolated raw
 * artifact strings into JSX text nodes, so `**bold**` shipped to the page as
 * literal asterisks and a section's prose vanished whenever it also carried
 * bullets. These tests pin semantic markdown output in every slot release
 * markdown can flow through — summary, section body, and section items.
 */
function markdownFixture(): ReleaseNotesArtifact {
  return {
    schemaVersion: 2,
    status: "published",
    publishedAt: "2026-09-01T00:00:00Z",
    packageName: "@kitsunekode/kunai",
    version: "9.9.9",
    tag: "v9.9.9",
    title: "Kunai 9.9.9",
    date: "2026-09-01",
    summary: "Lead **bold** claim with `code` and _italics_.",
    sections: [
      {
        title: "Mixed section",
        // Prose AND a list in one body — the prose must not be dropped.
        body: "Intro paragraph stays.\n\n- **bold item** with `code`",
        items: ["**bold item** with `code`"],
      },
    ],
    install: {
      npm: "npm install -g @kitsunekode/kunai@9.9.9",
      bunx: "bunx @kitsunekode/kunai@9.9.9",
      binaryLatest: "https://github.com/KitsuneKode/kunai/releases/latest",
    },
  };
}

describe("release markdown rendering", () => {
  test("MarkdownText emits semantic markup, never literal markers", () => {
    const html = renderToStaticMarkup(
      <MarkdownText>{"**bold** `code` _italic_ [link](https://example.com)"}</MarkdownText>,
    );

    expect(html).toContain("<strong");
    expect(html).toContain(">bold</strong>");
    expect(html).toContain(">code</code>");
    expect(html).toContain(">italic</em>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("**");
    expect(html).not.toContain("_italic_");
  });

  test("ReleaseDetail renders summary markdown semantically", () => {
    const html = renderToStaticMarkup(<ReleaseDetail release={markdownFixture()} />);

    expect(html).toContain("<strong");
    expect(html).toContain(">bold</strong>");
    expect(html).not.toContain("**bold**");
    expect(html).toContain("2026-09-01");
  });

  test("a section with both prose and a list keeps the prose", () => {
    const html = renderToStaticMarkup(<ReleaseDetail release={markdownFixture()} />);

    expect(html).toContain("Intro paragraph stays.");
    expect(html).toContain("<li");
  });

  test("kunai:// links never become clickable anchors", () => {
    const html = renderToStaticMarkup(
      <MarkdownText>{"[open](kunai://watch/abc123)"}</MarkdownText>,
    );

    expect(html).not.toContain('href="kunai://');
    expect(html).toContain("kunai://watch/abc123");
  });

  test("the real 0.3.0 artifact renders no literal markdown markers", () => {
    // 0.3.0's artifact is the regression source: a 33k-char summary full of
    // `**bold**` spans that used to ship to the page verbatim.
    const release = releaseNotesArtifacts.find((r) => r.version === "0.3.0");
    expect(release).toBeDefined();
    if (!release) return;

    const html = renderToStaticMarkup(<ReleaseDetail release={release} />);
    expect(html).not.toContain("**");
    expect(html).toContain("<strong");
    expect(html).toContain(release.date ?? "unreachable");
  });
});
