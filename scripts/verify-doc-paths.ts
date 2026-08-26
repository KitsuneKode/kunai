#!/usr/bin/env bun
// =============================================================================
// verify-doc-paths.ts — fail when an agent-facing doc cites a path that is gone.
//
// Doc rot in this repo has one dominant cause: a directory gets reorganized and
// the docs that route agents to it keep pointing at the old layout. That is
// silent — nothing breaks until an agent reads the doc and looks in the wrong
// place. This turns it into a build failure.
//
// Checks two things across AGENTS.md and .docs/** (which now contains agents/):
//   1. Backtick-quoted repo paths (`apps/cli/src/...`) resolve on disk.
//   2. Relative markdown links ([x](./y.md)) resolve on disk.
//
// And one thing across source comments in apps/** and packages/**:
//   3. Doc and file paths cited in comments resolve on disk.
//
// (3) exists because a comment is documentation that no doc checker could see.
// Three files pointed at `docs/superpowers/` and two at a plan that had been
// archived; nothing failed, because nothing was looking. Comments are checked
// package-relative first, then repo-relative, because a comment inside
// `apps/cli/scripts/build-binaries.ts` naming a sibling means the package's own
// directory, not a repo-root path.
//
// Usage:
//   bun run verify:doc-paths
// =============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/**
 * Docs that route agents. `archive/` is history — its paths are expected to be
 * stale. `provider-dossiers/` is field research citing live sites and captures,
 * not repo layout, so path checking there is noise.
 *
 * Only `.plans/roadmap.md` is scanned, not `.plans/**`. The roadmap is an index
 * of files that must exist. The plans it indexes are *intent*: they routinely
 * name files they propose to create, so gating them on existence would be a
 * category error and would punish planning ahead.
 */
const SCANNED_ROOTS = ["AGENTS.md", ".docs", ".plans/roadmap.md"];
const EXCLUDED_DIRS = new Set(["archive", "node_modules", "provider-dossiers"]);

/**
 * Paths that legitimately do not exist on a clean checkout. Keep this list
 * short and justified — every entry is a place the check cannot help.
 */
const ALLOWED_MISSING: readonly RegExp[] = [
  /^apps\/cli\/dist\//, // build output
  /(^|\/)\.prototypes\//, // gitignored local prototype harnesses
  /\.\.\./, // deliberately elided paths, e.g. packages/storage/.../x.ts
  /[*?]/, // globs
];

/**
 * Docs cite non-existent paths on purpose: to say a file was deleted, or to
 * name a package that is direction rather than code. A line carrying one of
 * these phrases is exempt.
 */
const HISTORICAL_MARKERS = [
  "removed",
  "deleted",
  "retired",
  "no longer exists",
  "not built",
  "does not exist",
];

type Finding = { readonly file: string; readonly target: string; readonly line: number };

function collectMarkdown(entry: string): string[] {
  const abs = join(ROOT, entry);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return abs.endsWith(".md") ? [abs] : [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((child) => {
    if (child.isDirectory()) {
      return EXCLUDED_DIRS.has(child.name) ? [] : collectMarkdown(join(entry, child.name));
    }
    return child.name.endsWith(".md") ? [join(abs, child.name)] : [];
  });
}

function isAllowedMissing(target: string): boolean {
  return ALLOWED_MISSING.some((pattern) => pattern.test(target));
}

function isHistorical(line: string): boolean {
  // Strip markdown emphasis so "has been **removed**" still matches "has been removed".
  const normalized = line.toLowerCase().replace(/[*_`]/g, "");
  return HISTORICAL_MARKERS.some((marker) => normalized.includes(marker));
}

// Only treat a backticked token as a repo path when it starts at a real
// top-level directory and contains a separator — `installId` is an identifier,
// `install.sh` is a file, and only the latter should be checked.
const CODE_PATH =
  /`((?:(?:apps|packages|scripts|archive)\/[A-Za-z0-9._/*?-]+|install\.(?:sh|ps1)))`/g;
const MD_LINK = /\]\(([^)#\s]+\.(?:md|mdx|ts|tsx|json|yaml|yml|sh|ps1|html))(?:#[^)]*)?\)/g;

function checkFile(absolute: string): Finding[] {
  const relative = absolute.slice(ROOT.length + 1);
  const findings: Finding[] = [];

  readFileSync(absolute, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (isHistorical(line)) return;

      for (const [, target] of line.matchAll(CODE_PATH)) {
        if (!target || isAllowedMissing(target)) continue;
        if (!existsSync(join(ROOT, target))) {
          findings.push({ file: relative, target, line: index + 1 });
        }
      }

      for (const [, target] of line.matchAll(MD_LINK)) {
        if (!target || target.startsWith("http") || isAllowedMissing(target)) continue;
        // Doc-relative only. A markdown renderer resolves a link against the
        // file it sits in, so accepting a repo-root fallback here passed links
        // that were already broken for a human reader — `.docs/providers.md`
        // written from inside `.docs/` is one, and it shipped.
        if (!existsSync(join(dirname(absolute), target))) {
          findings.push({ file: relative, target, line: index + 1 });
        }
      }
    });

  return findings;
}

// ---------------------------------------------------------------------------
// Source comments
// ---------------------------------------------------------------------------

/** Workspace roots whose comments are checked. `.reference/` and `.archive/` are excluded. */
const SOURCE_GLOBS = ["apps/**/*.{ts,tsx,mjs}", "packages/**/*.{ts,tsx,mjs}", "scripts/*.ts"];
const SOURCE_SKIP = /(^|\/)(node_modules|dist|\.next|\.turbo)\//;

/** A cited path is only checked when it names a file — bare directories are noise. */
const CITED_FILE = /\.(ts|tsx|md|mdx|json|ya?ml|sh|ps1|html|lua|mjs|js|tape)$/;

const COMMENT_PATH =
  /(?:^|[\s`("'[<])((?:\.docs|\.plans|\.reference|\.archive|docs|apps|packages|scripts|test)\/[A-Za-z0-9._/*?-]*[A-Za-z0-9._*?-])/g;

/** Comment spans only. A path inside a string literal is usually runtime data, not a citation. */
function commentSpans(text: string): { line: number; text: string }[] {
  const spans: { line: number; text: string }[] = [];
  let inBlock = false;

  text.split("\n").forEach((raw, index) => {
    let segment = "";
    if (inBlock) {
      const end = raw.indexOf("*/");
      segment = end === -1 ? raw : raw.slice(0, end);
      if (end !== -1) inBlock = false;
    } else {
      const block = raw.indexOf("/*");
      const line = raw.indexOf("//");
      if (block !== -1 && (line === -1 || block < line)) {
        const end = raw.indexOf("*/", block + 2);
        if (end === -1) {
          inBlock = true;
          segment = raw.slice(block + 2);
        } else {
          segment = raw.slice(block + 2, end);
        }
      } else if (line !== -1) {
        segment = raw.slice(line + 2);
      }
    }
    if (segment.trim()) spans.push({ line: index + 1, text: segment });
  });

  return spans;
}

/** Maps a source file to its workspace root, so package-relative citations resolve. */
function owningPackage(relative: string): string | undefined {
  const parts = relative.split("/");
  return parts[0] === "apps" || parts[0] === "packages" ? `${parts[0]}/${parts[1]}` : undefined;
}

function checkSourceFile(relative: string): Finding[] {
  const findings: Finding[] = [];
  const pkg = owningPackage(relative);

  for (const span of commentSpans(readFileSync(join(ROOT, relative), "utf8"))) {
    if (isHistorical(span.text)) continue;

    for (const [, raw] of span.text.matchAll(COMMENT_PATH)) {
      // A path ending a sentence captures its punctuation: `x.md.` or `x.ts),`.
      const target = raw?.replace(/[.,;:)\]]+$/, "");
      if (!target || !CITED_FILE.test(target) || isAllowedMissing(target)) continue;
      const resolvesInPackage = pkg !== undefined && existsSync(join(ROOT, pkg, target));
      if (resolvesInPackage || existsSync(join(ROOT, target))) continue;
      findings.push({ file: relative, target, line: span.line });
    }
  }

  return findings;
}

const sourceFiles = SOURCE_GLOBS.flatMap((pattern) => [
  ...new Bun.Glob(pattern).scanSync({ cwd: ROOT }),
])
  .map((path) => path.replaceAll("\\", "/"))
  .filter((path) => !SOURCE_SKIP.test(path));

const files = SCANNED_ROOTS.flatMap(collectMarkdown);
const findings = [...files.flatMap(checkFile), ...sourceFiles.flatMap(checkSourceFile)];

if (findings.length > 0) {
  console.error(`\nDead paths in agent-facing docs and comments (${findings.length}):\n`);
  for (const { file, line, target } of findings) {
    console.error(`  ${file}:${line}  →  ${target}`);
  }
  console.error(
    `\nFix the doc, or — if the path is cited as history — say so on the same line
(e.g. "the old x.ts was removed"). Add to ALLOWED_MISSING only when the path
genuinely cannot exist on a clean checkout.\n`,
  );
  process.exit(1);
}

console.log(
  `verify:doc-paths — ${files.length} docs and ${sourceFiles.length} source files scanned, ` +
    `all paths resolve.`,
);
