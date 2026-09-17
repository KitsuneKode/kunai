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
// Enforcing that the field *exists* is not enough. A field nothing checks stops
// tracking reality: when this half was added, 62 of 66 live docs carried a
// `lastReviewed` older than their own last commit, so the freshness signal that
// `AGENTS.md` tells every agent to trust had quietly become decoration. A doc
// asserting `status: current` over a body the tree has moved past is worse than
// an undated one — it invites confident work on a description of code that no
// longer exists.
//
// So the check also asks, of every doc a change actually touches: did the body
// change without the review date changing? That is a question about *this* diff,
// which is why there is no baseline file and no retroactive sweep. The 62 are
// not the bug this prevents — they are the reason it exists, and they get
// reconciled as they are next edited.
//
// Escape hatch for mechanical sweeps that cannot change meaning (a formatter
// run, a path rename): `SKIP_DOC_FRESHNESS=1`. Reach for it rarely, and never to
// get a content edit past the gate.
//
// Usage:
//   bun run verify:doc-frontmatter
//   DOC_FRESHNESS_BASE=origin/main bun run verify:doc-frontmatter
//   SKIP_DOC_FRESHNESS=1 bun run verify:doc-frontmatter
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BANNER = "Agent-facing (L3)";

/** `archive/` is history and carries the no-authority banner instead. */
const EXCLUDED_DIRS = ["archive/"];

const STATUS_VALUES = new Set(["current", "draft", "superseded"]);

const DOC_PREFIX = ".docs/";
const REVIEWED_LINE = /^[+-]lastReviewed:/m;

function git(...args: string[]): string | null {
  const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT });
  if (proc.exitCode !== 0) return null;
  return new TextDecoder().decode(proc.stdout);
}

/**
 * The commit this change set departs from.
 *
 * A shallow or detached CI checkout may not have the base ref at all. That is a
 * missing precondition, not a violation, so the freshness half is skipped with a
 * notice rather than failing a build for the shape of its checkout.
 */
function freshnessBase(): string | null {
  const configured = process.env.DOC_FRESHNESS_BASE;
  const candidates = configured ? [configured] : ["origin/main", "main"];
  for (const ref of candidates) {
    const merged = git("merge-base", "HEAD", ref)?.trim();
    if (merged) return merged;
  }
  return null;
}

/**
 * Docs whose body changed since `base` without their `lastReviewed` moving.
 *
 * Deletions are excluded (`--diff-filter=d`): a removed doc has nothing left to
 * reconcile. Additions are included — a new doc states a review date it should
 * have actually earned.
 */
function unreconciledSince(base: string): string[] {
  const changed = git("diff", "--name-only", "--diff-filter=d", base, "HEAD", "--", ".docs");
  if (changed === null) return [];

  const result: string[] = [];
  for (const path of changed.split("\n")) {
    if (!path.startsWith(DOC_PREFIX) || !path.endsWith(".md")) continue;
    if (EXCLUDED_DIRS.some((dir) => path.startsWith(DOC_PREFIX + dir))) continue;
    const patch = git("diff", "-U0", base, "HEAD", "--", path);
    if (patch !== null && !REVIEWED_LINE.test(patch)) result.push(path);
  }
  return result;
}

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

if (process.env.SKIP_DOC_FRESHNESS === "1") {
  console.log(
    `verify:doc-frontmatter — ${files.length} docs scanned, all declare status and ` +
      `audience. Freshness skipped (SKIP_DOC_FRESHNESS=1).`,
  );
  process.exit(0);
}

const base = freshnessBase();
if (base === null) {
  console.log(
    `verify:doc-frontmatter — ${files.length} docs scanned, all declare status and ` +
      `audience. Freshness skipped: no base ref (set DOC_FRESHNESS_BASE).`,
  );
  process.exit(0);
}

const unreconciled = unreconciledSince(base);
if (unreconciled.length > 0) {
  console.error("verify:doc-frontmatter — changed without being reconciled:\n");
  for (const path of unreconciled) console.error(`  ${path}`);
  console.error(
    `\n${unreconciled.length} doc(s) changed in this change set with no change to ` +
      `'lastReviewed'. Re-read each against the tree and set lastReviewed to today ` +
      `— or, for a mechanical sweep that cannot change meaning, re-run with ` +
      `SKIP_DOC_FRESHNESS=1.`,
  );
  process.exit(1);
}

console.log(
  `verify:doc-frontmatter — ${files.length} docs scanned, all declare status and ` +
    `audience; every doc changed since ${base.slice(0, 9)} was reconciled.`,
);
