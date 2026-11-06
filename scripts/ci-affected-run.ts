#!/usr/bin/env bun
// =============================================================================
// ci-affected-run.ts — run a turbo task with `--affected`, but never vacuously.
//
// Why this exists:
//
//   Every "always" CI job runs `--affected` on a pull request, because a full
//   turbo graph on every PR is slow. `--affected` selects the packages a change
//   touched — and when a change touches *no* workspace package it selects
//   nothing, prints a warning, and exits 0. Four green jobs then report success
//   having run zero tasks.
//
//   That is not hypothetical. These paths are all outside every workspace:
//
//     .github/**            install.sh, install.ps1
//     tools/**              test/install/**, docs/**, .docs/**, README.md
//
//   `bunx turbo run typecheck --affected` on such a diff returns:
//
//     { "tasks": [] }   exit 0
//
//   So a PR that edits only the installers, only a workflow, or only the docs
//   was typechecked, linted, format-checked and tested by nothing at all —
//   while `.docs/repo-infrastructure.md` calls those jobs "always".
//
// The fix is deliberately not a list of paths to force-run. A path list is a
// declaration that decays: the next top-level directory added to the repo
// matches nothing and silently opts out of CI again. Instead this asks the
// graph the only question that matters — did `--affected` actually select any
// task? — and falls back to a full run when the answer is no. A new top-level
// directory cannot escape it, because the question is asked of the graph rather
// than of a path list.
//
// Usage (drop-in for the existing job steps):
//
//   bun run scripts/ci-affected-run.ts typecheck
//   bun run scripts/ci-affected-run.ts test --summarize
//
// Exit code is the underlying turbo run's, so a real failure still fails CI.
// =============================================================================

import { spawnSync } from "node:child_process";

/** Parsed subset of `turbo run --dry=json` that this script depends on. */
type TurboDryRun = { readonly tasks?: readonly unknown[] };

/**
 * Patterns matching files whose modification can alter global toolchains,
 * configurations, or scripts, requiring the full graph to run even if
 * `--affected` selects a small subset of workspace packages.
 */
export const GLOBAL_BLAST_PATTERNS = [
  /^\.github\//,
  /^scripts\//,
  /^tools\//,
  /^patches\//,
  /^bunfig\.toml$/,
  /^turbo\.json$/,
  /^package\.json$/,
  /^bun\.lock$/,
  /^tsconfig(?:\.[^/]+)?\.json$/,
  /^\.oxlintrc(?:\.[^/]+)?\.json$/,
  /^\.oxfmtrc(?:\.[^/]+)?\.json$/,
  /^LICENSE$/,
] as const;

export function hasGlobalBlastFiles(changedFiles: readonly string[]): boolean {
  return changedFiles.some((file) => {
    const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
    return GLOBAL_BLAST_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}

/**
 * Query git for changed files compared against PR base or merge base.
 * Falls back gracefully to empty array if git is unavailable.
 */
export function getChangedFiles(
  env: NodeJS.ProcessEnv = process.env,
  gitRunner: (args: readonly string[]) => { stdout?: string; status?: number | null } = (args) =>
    spawnSync("git", [...args], { encoding: "utf8", env }),
): string[] {
  const candidateBases = [
    env.TURBO_SCM_BASE,
    env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : undefined,
    env.GITHUB_BASE_REF,
    "origin/main",
    "HEAD~1",
  ].filter((b): b is string => Boolean(b) && String(b).length > 0);

  for (const base of candidateBases) {
    const diff = gitRunner(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`]);
    if (diff.status === 0 && Boolean(diff.stdout)) {
      const files = String(diff.stdout)
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
      if (files.length > 0) return files;
    }
  }

  const status = gitRunner(["status", "--porcelain"]);
  if (status.status === 0 && Boolean(status.stdout)) {
    const files = String(status.stdout)
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter((f) => f.length > 0);
    if (files.length > 0) return files;
  }

  return [];
}

/**
 * Whether an `--affected` selection is too small or global blast invalidates it.
 *
 * Zero is the vacuous case. A positive selection alongside global blast files
 * (root configs, global tools/scripts) also requires a full run to prevent
 * partial-run false passes.
 */
export function needsFullRun(affectedTaskCount: number, hasGlobalBlast = false): boolean {
  return affectedTaskCount === 0 || hasGlobalBlast;
}

/** How many tasks `--affected` selects for `task`. Never throws. */
export function countAffectedTasks(
  task: string,
  passthrough: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): number {
  const result = spawnSync(
    "bunx",
    ["turbo", "run", task, "--affected", "--dry=json", ...passthrough],
    { encoding: "utf8", env },
  );
  if (result.error !== undefined || typeof result.stdout !== "string") return 0;
  try {
    const parsed = JSON.parse(result.stdout) as TurboDryRun;
    return parsed.tasks?.length ?? 0;
  } catch {
    // An unparseable dry run is not a reason to skip the task. Treat it as
    // "select nothing" so the caller runs the full graph.
    return 0;
  }
}

/** Run `task` for real, returning turbo's exit code. */
function runTurbo(
  task: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): number {
  const result = spawnSync("bunx", ["turbo", "run", task, ...args], {
    stdio: "inherit",
    env,
  });
  if (result.error !== undefined) {
    process.stderr.write(`ci-affected-run: could not run turbo: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

/**
 * Injectable seams. Turbo's `--affected` selection depends on git state, so the
 * decision is tested against a supplied count rather than against whatever the
 * working tree happens to look like. The real selection behaviour is reproduced
 * in the PR description and holds for a branch whose only commit touches
 * `README.md`.
 */
export type CiAffectedRunDeps = {
  readonly countTasks: (task: string, passthrough: readonly string[]) => number;
  readonly runTurbo: (task: string, args: readonly string[]) => number;
  readonly getChangedFiles?: () => readonly string[];
  readonly log?: (message: string) => void;
};

export function runAffectedOrFull(
  task: string,
  passthrough: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
  deps?: Partial<CiAffectedRunDeps>,
): number {
  const countTasks = deps?.countTasks ?? ((t, p) => countAffectedTasks(t, p, env));
  const run = deps?.runTurbo ?? ((t, a) => runTurbo(t, a, env));
  const log = deps?.log ?? ((message: string) => process.stdout.write(message));
  const changedFiles = (deps?.getChangedFiles ?? (() => getChangedFiles(env)))();
  const globalBlast = hasGlobalBlastFiles(changedFiles);

  const selected = countTasks(task, passthrough);
  if (!needsFullRun(selected, globalBlast)) {
    log(`ci-affected-run: ${selected} affected task(s) for \`${task}\`; running affected only.\n`);
    return run(task, ["--affected", ...passthrough]);
  }
  if (globalBlast) {
    const blastFiles = changedFiles.filter((f) => hasGlobalBlastFiles([f]));
    log(
      `ci-affected-run: root configuration or global tooling changed (${blastFiles.join(", ")}). Running the full graph.\n`,
    );
  } else {
    log(
      `ci-affected-run: no workspace package is affected by this change, so \`${task}\` ` +
        `--affected would run zero tasks and report success. Running the full graph.\n`,
    );
  }
  return run(task, [...passthrough]);
}

if (import.meta.main) {
  const [task, ...passthrough] = process.argv.slice(2);
  if (task === undefined || task.startsWith("-")) {
    process.stderr.write("usage: ci-affected-run.ts <task> [extra turbo args...]\n");
    process.exit(2);
  }
  process.exit(runAffectedOrFull(task, passthrough));
}
