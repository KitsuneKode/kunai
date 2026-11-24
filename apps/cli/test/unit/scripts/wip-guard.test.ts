import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  backupLocalWork,
  backupStamp,
  collectInventory,
  createGitRunner,
  defaultBackupDir,
  formatInventory,
  isAtRisk,
  pruneOldBackups,
} from "../../../../../scripts/wip-guard";
import { withoutGitEnv } from "../../helpers/git-env";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kunai-wip-guard-"));
  roots.push(root);
  const env = {
    ...withoutGitEnv(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = createGitRunner(repo, env);
  expect(git(["init", "--bare", "--initial-branch=main", remote], root).ok).toBe(true);
  expect(git(["init", "--initial-branch=main"]).ok).toBe(true);
  git(["config", "core.hooksPath", "/dev/null"]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(["add", "a.txt"]);
  git(["commit", "-m", "base"]);
  git(["remote", "add", "origin", remote]);
  expect(git(["push", "-q", "origin", "main"]).ok).toBe(true);
  git(["fetch", "-q", "origin"]);
  return { root, repo, git };
}

describe("wip guard", () => {
  test("a fully pushed, clean repo is not at risk", () => {
    const { git } = fixture();
    const inventory = collectInventory(git);
    expect(inventory).toEqual({ unpushedBranches: [], dirtyWorktrees: [], stashes: 0 });
    expect(isAtRisk(inventory)).toBe(false);
  });

  test("finds unpushed commits, uncommitted and untracked files, and stashes", () => {
    const { repo, git } = fixture();
    git(["checkout", "-q", "-b", "wip/redesign"]);
    writeFileSync(join(repo, "b.txt"), "local only\n");
    git(["add", "b.txt"]);
    git(["commit", "-q", "-m", "local only"]);
    writeFileSync(join(repo, "a.txt"), "edited\n");
    git(["stash", "-q"]);
    writeFileSync(join(repo, "a.txt"), "edited again\n");
    writeFileSync(join(repo, "new.css"), "body{}\n");

    const inventory = collectInventory(git);
    expect(inventory.unpushedBranches.map((branch) => branch.name)).toEqual(["wip/redesign"]);
    expect(inventory.unpushedBranches[0]?.commits).toBe(1);
    expect(inventory.dirtyWorktrees).toHaveLength(1);
    expect(inventory.dirtyWorktrees[0]).toMatchObject({ changes: 2, untracked: 1 });
    expect(inventory.stashes).toBe(1);
    expect(isAtRisk(inventory)).toBe(true);
    expect(formatInventory(inventory)).toContain("wip/redesign");
  });

  test("backup snapshots everything without touching the working tree", () => {
    const { root, repo, git } = fixture();
    git(["checkout", "-q", "-b", "wip/redesign"]);
    writeFileSync(join(repo, "b.txt"), "local only\n");
    git(["add", "b.txt"]);
    git(["commit", "-q", "-m", "local only"]);
    writeFileSync(join(repo, "a.txt"), "edited\n");
    git(["stash", "-q"]);
    writeFileSync(join(repo, "a.txt"), "uncommitted edit\n");
    writeFileSync(join(repo, "new.css"), "body{}\n");
    const statusBefore = git(["status", "--porcelain"]).stdout;

    const dir = join(root, "backups");
    const result = backupLocalWork(git, dir, new Date(2026, 10, 24, 22, 45));

    // Nothing in the working tree, index or stash list changed.
    expect(git(["status", "--porcelain"]).stdout).toBe(statusBefore);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("uncommitted edit\n");
    expect(git(["stash", "list"]).stdout.trim().split("\n")).toHaveLength(1);

    expect(result.worktreeRefs).toHaveLength(1);
    expect(result.stashRefs).toHaveLength(1);
    expect(result.archives).toHaveLength(1);
    expect(existsSync(result.bundle)).toBe(true);
    expect(git(["bundle", "verify", result.bundle]).ok).toBe(true);

    // The uncommitted edit is recoverable from the snapshot ref.
    const snapshot = result.worktreeRefs[0] ?? "";
    expect(git(["show", `${snapshot}:a.txt`]).stdout).toBe("uncommitted edit\n");
    // The unpushed branch is in the bundle.
    expect(git(["bundle", "list-heads", result.bundle]).stdout).toContain(
      "refs/heads/wip/redesign",
    );
  });

  test("backups default outside the Kunai profile and honour an override", () => {
    expect(defaultBackupDir({ KUNAI_WIP_BACKUP_DIR: "/srv/b" }, "kunai")).toBe(
      join("/srv/b", "kunai"),
    );
    expect(defaultBackupDir({}, "kunai")).toContain("kunai-dev-backups");
    expect(backupStamp(new Date(2026, 10, 24, 9, 5))).toBe("20261124-0905");
  });

  test("pruning keeps the newest backup runs and only touches backup files", () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-wip-prune-"));
    roots.push(root);
    for (const stamp of ["20261120-0100", "20261121-0100", "20261122-0100"]) {
      writeFileSync(join(root, `local-work-${stamp}.bundle`), "b");
      writeFileSync(join(root, `untracked-x-${stamp}.tar`), "t");
    }
    writeFileSync(join(root, "notes.txt"), "keep me");
    const removed = pruneOldBackups(root, 2);
    expect(removed.sort()).toEqual([
      "local-work-20261120-0100.bundle",
      "untracked-x-20261120-0100.tar",
    ]);
    expect(existsSync(join(root, "local-work-20261122-0100.bundle"))).toBe(true);
    expect(existsSync(join(root, "notes.txt"))).toBe(true);
  });
});
