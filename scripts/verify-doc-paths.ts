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
// Plus the mechanical half of the `.plans/` index contract:
//   4. roadmap.md indexes every `.plans/*.md`, and LANDED rows point into
//      `.archive/` — a landed plan does not stay in `.plans/`.
//   5. Active / in-progress plans carry a `lastReviewed` ISO date no older than
//      45 days (read from the file, not git history, so shallow CI clones work).
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
import { dirname, join, relative as relativePath, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

/**
 * What a clean checkout contains: tracked files plus untracked ones git would
 * pick up, and every directory above them. A gitignored file that happens to
 * exist on this machine is not in it, so the check gives the same answer
 * locally as in CI. The docs app's gitignored AGENTS.md once passed here and
 * failed in CI that way.
 * Falls back to the filesystem when git is unavailable.
 */
const CHECKOUT_PATHS: ReadonlySet<string> | undefined = (() => {
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "-co", "--exclude-standard"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (listed.exitCode !== 0) return undefined;
  const paths = new Set<string>([""]);
  for (const file of listed.stdout.toString().split("\0")) {
    if (!file) continue;
    paths.add(file);
    for (let cut = file.lastIndexOf("/"); cut > 0; cut = file.lastIndexOf("/", cut - 1)) {
      const dir = file.slice(0, cut);
      if (paths.has(dir)) break;
      paths.add(dir);
    }
  }
  return paths;
})();

function existsInCheckout(absolute: string): boolean {
  if (!CHECKOUT_PATHS) return existsSync(absolute);
  const rel = relativePath(ROOT, absolute).split(sep).join("/");
  if (rel.startsWith("..")) return existsSync(absolute);
  return CHECKOUT_PATHS.has(rel.replace(/\/$/, ""));
}

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

export type Finding = {
  readonly file: string;
  readonly target: string;
  readonly line: number;
};

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
        if (!existsInCheckout(join(ROOT, target))) {
          findings.push({ file: relative, target, line: index + 1 });
        }
      }

      for (const [, target] of line.matchAll(MD_LINK)) {
        if (!target || target.startsWith("http") || isAllowedMissing(target)) continue;
        // Doc-relative only. A markdown renderer resolves a link against the
        // file it sits in, so accepting a repo-root fallback here passed links
        // that were already broken for a human reader — `.docs/providers.md`
        // written from inside `.docs/` is one, and it shipped.
        if (!existsInCheckout(join(dirname(absolute), target))) {
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
      const resolvesInPackage = pkg !== undefined && existsInCheckout(join(ROOT, pkg, target));
      if (resolvesInPackage || existsInCheckout(join(ROOT, target))) continue;
      findings.push({ file: relative, target, line: span.line });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Roadmap hygiene
// ---------------------------------------------------------------------------
//
// `.plans/` is the only plan directory and `roadmap.md` its only index — "a
// plan that is not indexed here does not exist." Two of its rules are
// mechanical, so they are checked here:
//
//   1. Every `.plans/*.md` file must appear as a roadmap link. An added plan
//      with no row is invisible work — the drift this guards against.
//   2. A row whose status is LANDED must point into `.archive/` — a landed
//      plan does not stay in `.plans/`. (The converse does not hold: PARTIAL
//      rows legitimately point at archived plans whose core landed.)
//
// What this cannot check is whether a TODO row's work is actually finished.
// Status truth stays human.
//
// Exported for `apps/cli/test/unit/scripts/verify-doc-paths.test.ts`.

export function checkRoadmap(roadmapText: string, planFiles: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  const indexed = new Set<string>();
  // Forward slashes: `resolve` returns OS-native separators, so prefix checks
  // must normalize first or every row fails on Windows.
  const plansDir = `${ROOT}/.plans`.replaceAll("\\", "/");
  const archiveDir = `${ROOT}/.archive`.replaceAll("\\", "/");
  const roadmapDir = dirname(join(ROOT, ".plans/roadmap.md"));

  roadmapText.split("\n").forEach((line, index) => {
    const links = [...line.matchAll(MD_LINK)]
      .map((match) => match[1])
      .filter((target): target is string => Boolean(target));
    if (links.length === 0) return;

    // Rows are `| link | issue | remaining | STATUS |`; the trailing pipe
    // leaves an empty last cell, so the status is the second-to-last field.
    const cells = line.split("|").map((cell) => cell.trim());
    const status = cells.at(-2) ?? "";

    for (const target of links) {
      if (target.startsWith("http")) continue;
      const resolved = resolve(roadmapDir, target).replaceAll("\\", "/");
      if (resolved.startsWith(plansDir + "/")) indexed.add(resolved);
      if (
        (status === "LANDED" || status.startsWith("LANDED ")) &&
        !resolved.startsWith(archiveDir + "/")
      ) {
        findings.push({
          file: ".plans/roadmap.md",
          target: `${target} (LANDED row must point into .archive/)`,
          line: index + 1,
        });
      }
    }
  });

  for (const name of planFiles) {
    if (name === "roadmap.md" || !name.endsWith(".md")) continue;
    if (!indexed.has(`${plansDir}/${name}`)) {
      findings.push({
        file: `.plans/${name}`,
        target: "not indexed by .plans/roadmap.md",
        line: 1,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Active plan freshness
// ---------------------------------------------------------------------------
//
// `.plans/` holds unfinished work only, yet shipped plans can linger with
// `Status: active`. CI uses shallow clones, so freshness is read from an
// explicit `lastReviewed` field in the plan file (same YAML frontmatter
// convention as `.docs/`), never from git dates.

export const MAX_ACTIVE_PLAN_AGE_DAYS = 45;
const MS_PER_DAY = 86_400_000;

/**
 * Shipped plans intentionally left for the maintainer to archive rather than
 * stamped with a synthetic review date. Remove each entry once archived.
 */
const PENDING_MAINTAINER_ARCHIVE: ReadonlySet<string> = new Set([
  "2026-08-24-0-3-0-merge-train.md",
]);

function extractFrontmatter(
  text: string,
): { readonly body: string; readonly lineOffset: number } | null {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return null;
  return { body: normalized.slice(4, end), lineOffset: 2 };
}

function isActiveOrInProgressPlan(text: string): boolean {
  const normalized = text.replaceAll("\r\n", "\n");
  const frontmatter = extractFrontmatter(normalized);
  if (frontmatter && /^status:\s*["']?(?:active|in[\s-]progress)\b/im.test(frontmatter.body)) {
    return true;
  }
  const lines = normalized.split("\n").slice(0, 40);
  for (const raw of lines) {
    const cleaned = raw
      .trim()
      .replace(/^-\s+/, "")
      .replace(/^#+\s*/, "")
      .replace(/[*_`]/g, "")
      .trim();
    if (/^status\s*:\s*(?:active|in[\s-]progress)\b/i.test(cleaned)) {
      return true;
    }
  }
  return false;
}

function extractPlanLastReviewed(
  text: string,
): { readonly value: string; readonly line: number } | null {
  const normalized = text.replaceAll("\r\n", "\n");
  const frontmatter = extractFrontmatter(normalized);
  if (frontmatter) {
    const fmLines = frontmatter.body.split("\n");
    for (let i = 0; i < fmLines.length; i++) {
      const match = /^lastReviewed:\s*["']?([^"'\s#]+)["']?\s*$/.exec(fmLines[i] ?? "");
      if (match?.[1]) return { value: match[1], line: frontmatter.lineOffset + i };
    }
  }
  const headLines = normalized.split("\n").slice(0, 40);
  for (let i = 0; i < headLines.length; i++) {
    const cleaned = (headLines[i] ?? "").trim().replace(/^-\s+/, "").replace(/[*_`]/g, "");
    const match = /^lastReviewed\s*:\s*["']?([^"'\s#]+)["']?\s*$/i.exec(cleaned);
    if (match?.[1]) return { value: match[1], line: i + 1 };
  }
  return null;
}

function parseIsoReviewDateMs(raw: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(raw)) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  const canonical = new Date(parsed).toISOString().replace(".000Z", "Z").slice(0, raw.length);
  return canonical === raw ? parsed : null;
}

export type PlanDocument = {
  readonly name: string;
  readonly text: string;
};

export type ActivePlanCheckOptions = {
  readonly nowMs?: number;
  readonly maxAgeDays?: number;
  readonly exempt?: ReadonlySet<string>;
};

export function checkActivePlans(
  plans: readonly PlanDocument[],
  options: ActivePlanCheckOptions = {},
): Finding[] {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeDays = options.maxAgeDays ?? MAX_ACTIVE_PLAN_AGE_DAYS;
  const exempt = options.exempt ?? new Set<string>();
  const findings: Finding[] = [];

  for (const { name, text } of plans) {
    if (name === "roadmap.md" || !name.endsWith(".md") || exempt.has(name)) continue;
    if (!isActiveOrInProgressPlan(text)) continue;

    const reviewed = extractPlanLastReviewed(text);
    if (!reviewed) {
      findings.push({
        file: `.plans/${name}`,
        line: 1,
        target:
          'active/in-progress plan missing lastReviewed (add frontmatter lastReviewed: "YYYY-MM-DD")',
      });
      continue;
    }

    const reviewedMs = parseIsoReviewDateMs(reviewed.value);
    if (reviewedMs === null) {
      findings.push({
        file: `.plans/${name}`,
        line: reviewed.line,
        target: `lastReviewed '${reviewed.value}' is not a valid ISO date`,
      });
      continue;
    }

    const ageMs = nowMs - reviewedMs;
    if (ageMs > maxAgeDays * MS_PER_DAY) {
      const ageDays = Math.floor(ageMs / MS_PER_DAY);
      findings.push({
        file: `.plans/${name}`,
        line: reviewed.line,
        target: `active/in-progress plan lastReviewed '${reviewed.value}' is ${ageDays}d old (max ${maxAgeDays}d — re-verify or archive)`,
      });
    }
  }

  return findings;
}

// `import.meta.main` keeps the executable half out of the test import —
// pulling in `checkRoadmap` must not run the repo-wide scan or exit.
if (import.meta.main) {
  const sourceFiles = SOURCE_GLOBS.flatMap((pattern) => [
    ...new Bun.Glob(pattern).scanSync({ cwd: ROOT }),
  ])
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !SOURCE_SKIP.test(path));

  const files = SCANNED_ROOTS.flatMap(collectMarkdown);

  const plansDir = join(ROOT, ".plans");
  const planFileNames = existsSync(plansDir)
    ? readdirSync(plansDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    : [];
  const roadmapPath = join(plansDir, "roadmap.md");
  const roadmapFindings = existsSync(roadmapPath)
    ? checkRoadmap(readFileSync(roadmapPath, "utf8"), planFileNames)
    : [];
  const activePlanFindings = checkActivePlans(
    planFileNames
      .filter((name) => name !== "roadmap.md" && name.endsWith(".md"))
      .map((name) => ({ name, text: readFileSync(join(plansDir, name), "utf8") })),
    { exempt: PENDING_MAINTAINER_ARCHIVE },
  );

  const findings = [
    ...files.flatMap(checkFile),
    ...sourceFiles.flatMap(checkSourceFile),
    ...roadmapFindings,
    ...activePlanFindings,
  ];

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
}
