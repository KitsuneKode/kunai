#!/usr/bin/env bun
/**
 * Never lose local work again.
 *
 * A website redesign once lived only as uncommitted files in a checkout, and
 * survived by luck in a local backup commit. This script makes that class of
 * loss visible and recoverable:
 *
 * - `bun run wip:audit` lists every local branch with commits that exist on no
 *   remote, every worktree with uncommitted or untracked changes, and the stash
 *   count. `--strict` exits 1 when anything is at risk.
 * - `bun run wip:backup` snapshots all of it WITHOUT touching any working tree:
 *   dirty worktrees become commits under `refs/backup/worktrees/*` (via
 *   `git stash create`, which writes no files and leaves the index alone),
 *   stashes are pinned under `refs/backup/stashes/*`, untracked files are
 *   archived, and every branch, tag and backup ref is written to a git bundle
 *   outside the repository.
 *
 * Backups go to `KUNAI_WIP_BACKUP_DIR`, else the OS data dir under
 * `kunai-dev-backups/<repo>` — never the Kunai user profile.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
}

export type GitRunner = (args: readonly string[], cwd?: string, stdin?: string) => GitResult;

export function createGitRunner(repo: string, env: NodeJS.ProcessEnv = process.env): GitRunner {
  return (args, cwd = repo, stdin) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env,
      stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { ok: result.exitCode === 0, stdout: result.stdout.toString() };
  };
}

export interface UnpushedBranch {
  readonly name: string;
  readonly commits: number;
  readonly lastCommit: string;
}

export interface DirtyWorktree {
  readonly path: string;
  readonly changes: number;
  readonly untracked: number;
}

export interface WipInventory {
  readonly unpushedBranches: readonly UnpushedBranch[];
  readonly dirtyWorktrees: readonly DirtyWorktree[];
  readonly stashes: number;
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim().length > 0);
}

export function listWorktrees(git: GitRunner): string[] {
  return lines(git(["worktree", "list", "--porcelain"]).stdout)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

export function collectInventory(git: GitRunner): WipInventory {
  const unpushedBranches: UnpushedBranch[] = [];
  for (const name of lines(
    git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]).stdout,
  )) {
    const count = Number(git(["rev-list", "--count", name, "--not", "--remotes"]).stdout.trim());
    if (Number.isSafeInteger(count) && count > 0) {
      const lastCommit = git(["log", "-1", "--format=%cs", name]).stdout.trim();
      unpushedBranches.push({ name, commits: count, lastCommit });
    }
  }
  unpushedBranches.sort((a, b) => b.lastCommit.localeCompare(a.lastCommit));

  const dirtyWorktrees: DirtyWorktree[] = [];
  for (const path of listWorktrees(git)) {
    const status = git(["status", "--porcelain"], path);
    if (!status.ok) continue;
    const entries = lines(status.stdout);
    if (entries.length === 0) continue;
    const untracked = entries.filter((entry) => entry.startsWith("??")).length;
    dirtyWorktrees.push({ path, changes: entries.length, untracked });
  }

  const stashes = lines(git(["stash", "list", "--format=%H"]).stdout).length;
  return { unpushedBranches, dirtyWorktrees, stashes };
}

export function isAtRisk(inventory: WipInventory): boolean {
  return (
    inventory.unpushedBranches.length > 0 ||
    inventory.dirtyWorktrees.length > 0 ||
    inventory.stashes > 0
  );
}

export function formatInventory(inventory: WipInventory): string {
  const out: string[] = [];
  out.push(`Local branches with commits on no remote: ${inventory.unpushedBranches.length}`);
  for (const branch of inventory.unpushedBranches.slice(0, 25)) {
    out.push(`  ${branch.lastCommit}  ${String(branch.commits).padStart(3)}  ${branch.name}`);
  }
  if (inventory.unpushedBranches.length > 25) {
    out.push(`  … ${inventory.unpushedBranches.length - 25} more`);
  }
  out.push(`Worktrees with uncommitted changes: ${inventory.dirtyWorktrees.length}`);
  for (const worktree of inventory.dirtyWorktrees) {
    out.push(`  ${String(worktree.changes).padStart(4)} (${worktree.untracked} untracked)  ${worktree.path}`);
  }
  out.push(`Stashes: ${inventory.stashes}`);
  if (isAtRisk(inventory)) {
    out.push("Run `bun run wip:backup` to snapshot all of it outside the repo.");
  }
  return out.join("\n");
}

export function defaultBackupDir(env: NodeJS.ProcessEnv, repoName: string): string {
  if (env.KUNAI_WIP_BACKUP_DIR) return join(env.KUNAI_WIP_BACKUP_DIR, repoName);
  const base =
    process.platform === "win32"
      ? (env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : (env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"));
  return join(base, "kunai-dev-backups", repoName);
}

export interface BackupResult {
  readonly worktreeRefs: readonly string[];
  readonly stashRefs: readonly string[];
  readonly archives: readonly string[];
  readonly bundle: string;
}

/** Filesystem-safe stamp, e.g. 20261124-2245. */
export function backupStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function backupLocalWork(git: GitRunner, dir: string, now: Date): BackupResult {
  mkdirSync(dir, { recursive: true });
  const stamp = backupStamp(now);
  const worktreeRefs: string[] = [];
  const archives: string[] = [];

  for (const path of listWorktrees(git)) {
    const status = git(["status", "--porcelain"], path);
    if (!status.ok || lines(status.stdout).length === 0) continue;
    const name = basename(path);
    // `stash create` writes a commit object only: no files, index or stash
    // list change. It fails during an unresolved merge; the bundle and the
    // untracked archive still cover that worktree's committed and new files.
    const snapshot = git(["stash", "create", `wip-guard backup of ${path} at ${stamp}`], path);
    const commit = snapshot.stdout.trim();
    if (snapshot.ok && commit.length > 0) {
      const ref = `refs/backup/worktrees/${name}-${stamp}`;
      if (git(["update-ref", ref, commit]).ok) worktreeRefs.push(ref);
    }
    const untracked = lines(git(["ls-files", "--others", "--exclude-standard"], path).stdout);
    if (untracked.length > 0) {
      const archive = join(dir, `untracked-${name}-${stamp}.tar`);
      const tar = Bun.spawnSync(["tar", "-cf", archive, "-C", path, ...untracked], {
        stdout: "ignore",
        stderr: "ignore",
      });
      if (tar.exitCode === 0) archives.push(archive);
    }
  }

  const stashRefs: string[] = [];
  lines(git(["stash", "list", "--format=%H"]).stdout).forEach((hash, index) => {
    const ref = `refs/backup/stashes/${stamp}-${index}`;
    if (git(["update-ref", ref, hash]).ok) stashRefs.push(ref);
  });

  const refs = git([
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
    "refs/tags",
    "refs/backup",
  ]).stdout;
  const bundle = join(dir, `local-work-${stamp}.bundle`);
  const created = git(["bundle", "create", bundle, "--stdin"], undefined, refs);
  if (!created.ok) throw new Error(`git bundle create failed for ${bundle}`);
  pruneOldBackups(dir, BACKUPS_KEPT);
  return { worktreeRefs, stashRefs, archives, bundle };
}

/** Nightly backups would grow without bound; keep the newest runs only. */
export const BACKUPS_KEPT = 14;

export function pruneOldBackups(dir: string, keep: number): string[] {
  const stamps = [
    ...new Set(
      readdirSync(dir)
        .map((name) => /-(\d{8}-\d{4})\.(?:bundle|tar)$/.exec(name)?.[1])
        .filter((stamp): stamp is string => stamp !== undefined),
    ),
  ].sort();
  const expired = new Set(stamps.slice(0, Math.max(0, stamps.length - keep)));
  const removed: string[] = [];
  for (const name of readdirSync(dir)) {
    const stamp = /-(\d{8}-\d{4})\.(?:bundle|tar)$/.exec(name)?.[1];
    if (stamp !== undefined && expired.has(stamp)) {
      rmSync(join(dir, name), { force: true });
      removed.push(name);
    }
  }
  return removed;
}

function main(): number {
  const [command = "audit", ...flags] = process.argv.slice(2);
  const repo = process.cwd();
  const git = createGitRunner(repo);
  const top = git(["rev-parse", "--show-toplevel"]).stdout.trim() || repo;
  if (command === "audit") {
    const inventory = collectInventory(git);
    console.log(formatInventory(inventory));
    return flags.includes("--strict") && isAtRisk(inventory) ? 1 : 0;
  } else if (command === "backup") {
    const dir = defaultBackupDir(process.env, basename(top));
    const result = backupLocalWork(git, dir, new Date());
    console.log(
      [
        `Bundle: ${result.bundle}`,
        `Worktree snapshots: ${result.worktreeRefs.length}`,
        `Stashes pinned: ${result.stashRefs.length}`,
        `Untracked archives: ${result.archives.length}`,
        `Restore a branch with: git fetch ${result.bundle} 'refs/heads/<name>:refs/heads/<name>'`,
      ].join("\n"),
    );
  } else {
    console.error("usage: bun run scripts/wip-guard.ts [audit [--strict] | backup]");
    return 2;
  }
  return 0;
}

if (import.meta.main) process.exit(main());
