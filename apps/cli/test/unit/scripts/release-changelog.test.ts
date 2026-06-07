import { describe, expect, test } from "bun:test";

import {
  compareSemver,
  highestChangelogVersion,
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
