import { describe, expect, test } from "bun:test";

import {
  buildReleaseNotesArtifact,
  parseReleaseBodySections,
  renderReleaseNotesMarkdown,
} from "../../../../../scripts/generate-release-notes.ts";

describe("parseReleaseBodySections", () => {
  test("keeps summary copy and grouped release sections", () => {
    const parsed = parseReleaseBodySections(`A focused release with provider fixes.

Second summary line.

### Highlights

- Faster playback across
  provider fallback.
- Cleaner source picker.

### Fixes

- Retry no-stream screens correctly.
`);

    expect(parsed.summary).toBe("A focused release with provider fixes.\n\nSecond summary line.");
    expect(parsed.sections).toEqual([
      {
        title: "Highlights",
        body: "- Faster playback across\n  provider fallback.\n- Cleaner source picker.",
        items: ["Faster playback across provider fallback.", "Cleaner source picker."],
      },
      {
        title: "Fixes",
        body: "- Retry no-stream screens correctly.",
        items: ["Retry no-stream screens correctly."],
      },
    ]);
  });
});

describe("buildReleaseNotesArtifact", () => {
  test("creates a stable public artifact from a changelog entry", () => {
    const artifact = buildReleaseNotesArtifact({
      packageName: "@kitsunekode/kunai",
      version: "0.2.6",
      body: `A boringly reliable playback release.

### Highlights

- Registry-backed playback hints.

### Internal

- Release note artifact generation.
`,
    });

    expect(artifact).toMatchObject({
      schemaVersion: 1,
      packageName: "@kitsunekode/kunai",
      version: "0.2.6",
      tag: "v0.2.6",
      title: "Kunai 0.2.6",
      date: null,
      summary: "A boringly reliable playback release.",
    });
    expect(artifact.sections.map((section) => section.title)).toEqual(["Highlights", "Internal"]);
  });
});

describe("renderReleaseNotesMarkdown", () => {
  test("renders the artifact as a GitHub release body", () => {
    const artifact = buildReleaseNotesArtifact({
      packageName: "@kitsunekode/kunai",
      version: "0.2.6",
      body: `A release.

### Fixes

- Better retry feedback.
`,
    });

    expect(renderReleaseNotesMarkdown(artifact)).toBe(`# Kunai 0.2.6

A release.

### Fixes

- Better retry feedback.
`);
  });

  test("renders formatter-stable single emphasis", () => {
    const artifact = buildReleaseNotesArtifact({
      packageName: "@kitsunekode/kunai",
      version: "0.2.6",
      body: `A release.

### Fixes

- Keeps *single emphasis* stable while preserving **strong emphasis**.
`,
    });

    expect(renderReleaseNotesMarkdown(artifact)).toContain(
      "Keeps _single emphasis_ stable while preserving **strong emphasis**.",
    );
  });
});
