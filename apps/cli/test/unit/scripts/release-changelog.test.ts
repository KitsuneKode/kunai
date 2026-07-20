import { describe, expect, test } from "bun:test";

import {
  compareSemver,
  highestChangelogVersion,
  parseChangesetEntries,
  parseRootChangelogEntry,
  parseTopCliChangelogEntry,
} from "../../../../../scripts/release-changelog.ts";

describe("compareSemver", () => {
  test("orders patch releases", () => {
    expect(compareSemver("0.2.6", "0.2.5")).toBeGreaterThan(0);
    expect(compareSemver("0.2.5", "0.2.6")).toBeLessThan(0);
    expect(compareSemver("0.2.5", "0.2.5")).toBe(0);
  });
});

describe("highestChangelogVersion", () => {
  test("finds the highest per-package version", () => {
    const content = `# pkg

## 0.2.4

notes

## 0.2.5

notes
`;
    expect(highestChangelogVersion(content, "## ")).toBe("0.2.5");
  });

  test("finds the highest root version with v prefix", () => {
    const content = `# Changelog

## v0.2.4

notes

## v0.2.5

notes
`;
    expect(highestChangelogVersion(content, "## v")).toBe("0.2.5");
  });
});

describe("parseTopCliChangelogEntry", () => {
  test("strips github patch wrapper and unindents narrative body", () => {
    const content = `# pkg

## 0.2.6

### Patch Changes

- [abc1234](https://github.com/KitsuneKode/kunai/commit/abc1234) Thanks [@kitsunekode](https://github.com/kitsunekode)! - Provider flavor picker fix

  ### Highlights
  - More servers visible
`;
    const entry = parseTopCliChangelogEntry(content);
    expect(entry?.version).toBe("0.2.6");
    expect(entry?.body).toContain("Provider flavor picker fix");
    expect(entry?.body).toContain("### Highlights");
    expect(entry?.body).not.toMatch(/^  - More servers/m);
  });

  test("parses minor and patch groups without wrapper headings", () => {
    const entry = parseTopCliChangelogEntry(`
## 0.3.0

### Minor Changes

- abc123: Add queue recovery.

  #### Highlights

  Exact queue acknowledgement.

### Patch Changes

- def456: Fix installer ownership.
`);

    expect(entry?.version).toBe("0.3.0");
    expect(entry?.body).toContain("Add queue recovery");
    expect(entry?.body).toContain("### Highlights");
    expect(entry?.body).toContain("Fix installer ownership");
    expect(entry?.body).not.toContain("### Minor Changes");
    expect(entry?.body).not.toContain("### Patch Changes");
  });

  test("parses a major group and drops the wrapper heading", () => {
    const entry = parseTopCliChangelogEntry(`
## 1.0.0

### Major Changes

- abc123: Drop the legacy browser runtime.
`);

    expect(entry?.version).toBe("1.0.0");
    expect(entry?.body).toContain("Drop the legacy browser runtime");
    expect(entry?.body).not.toContain("### Major Changes");
  });

  test("keeps every entry within a group", () => {
    const entry = parseTopCliChangelogEntry(`
## 0.3.0

### Patch Changes

- abc123: Fix installer ownership.
- def456: Fix queue resume ordering.
- fed321: Fix share link parsing.
`);

    expect(entry?.body).toContain("Fix installer ownership");
    expect(entry?.body).toContain("Fix queue resume ordering");
    expect(entry?.body).toContain("Fix share link parsing");
  });

  test("strips HTML comments from changeset bodies", () => {
    const entry = parseTopCliChangelogEntry(`
## 0.3.0

### Patch Changes

- abc123: Fix installer ownership.
  <!-- draft: verify on macOS before shipping -->
`);

    expect(entry?.body).toContain("Fix installer ownership");
    expect(entry?.body).not.toContain("draft");
    expect(entry?.body).not.toContain("<!--");
  });

  test("keeps a human-written summary without leaking draft notes", () => {
    const entry = parseTopCliChangelogEntry(`
## 0.3.0

### Minor Changes

- abc123: Rework installer ownership so reinstalls keep user files.

  #### Notes

  <!-- TODO: reword before release -->
  Reinstalling no longer chowns files you already own.
`);

    expect(entry?.body).toContain("Rework installer ownership so reinstalls keep user files");
    expect(entry?.body).toContain("Reinstalling no longer chowns files you already own");
    expect(entry?.body).toContain("### Notes");
    expect(entry?.body).not.toContain("TODO");
    expect(entry?.body).not.toContain("reword before release");
  });
});

describe("parseChangesetEntries", () => {
  test("returns ordered, kind-tagged entries with attribution removed", () => {
    const changes = parseChangesetEntries(`### Minor Changes

- abc123: Add queue recovery.

### Patch Changes

- [def4567](https://github.com/KitsuneKode/kunai/commit/def4567) Thanks [@kitsunekode](https://github.com/kitsunekode)! - Fix installer ownership.
`);

    expect(changes.map((change) => change.kind)).toEqual(["minor", "patch"]);
    expect(changes[0]?.body).toBe("Add queue recovery.");
    expect(changes[1]?.body).toBe("Fix installer ownership.");
  });
});

describe("parseRootChangelogEntry", () => {
  test("reads an existing root section", () => {
    const content = `# Changelog

## v0.2.5

Already mirrored.

## v0.2.4

Older.
`;
    const entry = parseRootChangelogEntry(content, "v0.2.5");
    expect(entry?.version).toBe("0.2.5");
    expect(entry?.body).toBe("Already mirrored.");
  });
});
