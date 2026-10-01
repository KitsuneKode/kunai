import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findConflictMarkers } from "../../../../../scripts/verify-active-conflicts";

test("a lone conflict marker fails and an archived patch does not", () => {
  const root = mkdtempSync(join(tmpdir(), "kunai-conflicts-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".archive"));
  writeFileSync(join(root, "src", "live.ts"), "<<<<<<< HEAD\nconst value = 1;\n");
  writeFileSync(join(root, "src", "heading.md"), "# A normal heading\n\nNothing to merge.\n");
  writeFileSync(join(root, ".archive", "old.patch"), "<<<<<<< HEAD\nold\n");

  expect(findConflictMarkers(root)).toEqual(["src/live.ts"]);
});

test("local CI runs formatting and the docs checks", () => {
  const root = resolve(import.meta.dir, "../../../../..");
  const pkg: { scripts: Record<string, string> } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  expect(pkg.scripts["fmt:check"]).toContain("fmt:root:check");
  expect(pkg.scripts.ci).toContain("fmt:check");
  expect(pkg.scripts.ci).toContain("verify:doc-frontmatter");
  expect(pkg.scripts.ci).toContain("verify:doc-paths");
  expect(pkg.scripts.ci).toContain("verify:active-conflicts");
  expect(pkg.scripts["ci:affected"]).toContain("fmt:check");
  expect(pkg.scripts["ci:affected"]).toContain("verify:doc-frontmatter");
  expect(ci).toContain("bun run fmt:root:check");
});
