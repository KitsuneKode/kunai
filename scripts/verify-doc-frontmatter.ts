#!/usr/bin/env bun
// =============================================================================
// verify-doc-frontmatter.ts — fail when an agent-facing doc cannot state what it is.
//
// A doc fragment read out of context is unplaceable: an agent cannot tell
// authority from history from aspiration. Two cheap markers fix that, and this
// check keeps them from decaying as docs are added.
//
// Every live `.docs/**/*.md` must carry:
//   1. YAML frontmatter with `status:` and `lastReviewed:`
//   2. the L3 audience banner directly under its H1
//
// `lastReviewed` records when a human or agent last reconciled the doc with the
// code. It is NOT a formatting stamp — do not bulk-update it to "today" without
// actually re-reading the doc against the tree.
//
// Usage:
//   bun run verify:doc-frontmatter
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BANNER = "Agent-facing (L3)";

/** `archive/` is history and carries the no-authority banner instead. */
const EXCLUDED_DIRS = ["archive/"];

const STATUS_VALUES = new Set(["current", "draft", "superseded"]);

const files = [...new Bun.Glob("**/*.md").scanSync({ cwd: resolve(ROOT, ".docs") })]
  .filter((path) => !EXCLUDED_DIRS.some((dir) => path.startsWith(dir)))
  .sort();

const problems: string[] = [];

for (const relative of files) {
  const path = `.docs/${relative}`;
  const text = readFileSync(resolve(ROOT, path), "utf8");

  if (!text.startsWith("---\n")) {
    problems.push(`${path} — no YAML frontmatter`);
    continue;
  }

  const end = text.indexOf("\n---", 4);
  const frontmatter = end === -1 ? "" : text.slice(4, end);

  const status = /^status:\s*(\S+)/m.exec(frontmatter)?.[1];
  if (!status) {
    problems.push(`${path} — frontmatter missing 'status:'`);
  } else if (!STATUS_VALUES.has(status.replace(/["']/g, ""))) {
    problems.push(`${path} — status '${status}' is not one of: ${[...STATUS_VALUES].join(", ")}`);
  }

  const reviewed = /^lastReviewed:\s*"?(\S+?)"?\s*$/m.exec(frontmatter)?.[1];
  if (!reviewed) {
    problems.push(`${path} — frontmatter missing 'lastReviewed:'`);
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewed)) {
    // "unknown" and friends silently defeat the point of the field.
    problems.push(`${path} — lastReviewed '${reviewed}' is not an ISO date (YYYY-MM-DD)`);
  }

  if (!text.includes(BANNER)) {
    problems.push(`${path} — missing the audience banner under its H1`);
  }
}

if (problems.length > 0) {
  console.error("verify:doc-frontmatter — agent docs cannot state what they are:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\n${problems.length} problem(s). Every live .docs doc needs frontmatter ` +
      `(status + lastReviewed) and the L3 banner under its H1.`,
  );
  process.exit(1);
}

console.log(
  `verify:doc-frontmatter — ${files.length} docs scanned, all declare status and audience.`,
);
