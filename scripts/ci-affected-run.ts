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
 * Whether an `--affected` selection is too small to prove anything.
 *
 * Zero is the only vacuous case. One selected task is a real signal, even if it
 * is a small one — the affected set is a statement about blast radius, not
 * about whether the task ran.
 */
export function needsFullRun(affectedTaskCount: number): boolean {
  return affectedTaskCount === 0;
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

  const selected = countTasks(task, passthrough);
  if (!needsFullRun(selected)) {
    log(`ci-affected-run: ${selected} affected task(s) for \`${task}\`; running affected only.\n`);
    return run(task, ["--affected", ...passthrough]);
  }
  log(
    `ci-affected-run: no workspace package is affected by this change, so \`${task}\` ` +
      `--affected would run zero tasks and report success. Running the full graph.\n`,
  );
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
