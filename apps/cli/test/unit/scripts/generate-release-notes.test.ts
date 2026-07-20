import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildReleaseNotesArtifact,
  parseReleaseBodySections,
  renderReleaseNotesMarkdown,
  writeArtifact,
} from "../../../../../scripts/generate-release-notes.ts";

const BASE_ARTIFACT = buildReleaseNotesArtifact({
  packageName: "@kitsunekode/kunai",
  version: "0.3.0",
  body: `A base release.

### Fixes

- Preserve verified assets.
`,
});

const NEXT_ARTIFACT = buildReleaseNotesArtifact({
  packageName: "@kitsunekode/kunai",
  version: "0.3.0",
  body: `A regenerated release.

### Fixes

- Preserve verified assets on regeneration.
`,
});

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

describe("writeArtifact", () => {
  let tempDir: string;
  let artifactPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kunai-release-notes-"));
    artifactPath = join(tempDir, "kunai-v0.3.0.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("regeneration preserves existing verified assets", async () => {
    await Bun.write(
      artifactPath,
      JSON.stringify({
        ...BASE_ARTIFACT,
        assets: [{ name: "kunai-linux-x64", sha256: "a".repeat(64) }],
      }),
    );

    await writeArtifact({ path: artifactPath, artifact: NEXT_ARTIFACT });

    expect(await Bun.file(artifactPath).json()).toMatchObject({
      assets: [{ name: "kunai-linux-x64", sha256: "a".repeat(64) }],
    });
  });

  test("malformed existing JSON falls back without crashing", async () => {
    await Bun.write(artifactPath, "{not-json");
    await expect(
      writeArtifact({ path: artifactPath, artifact: NEXT_ARTIFACT }),
    ).resolves.toBeUndefined();
  });
});
