import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../../..");
const STATUS_PATH = "apps/docs/lib/generated-provider-status.json";
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/provider-status-sweep.yml"), "utf8");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(cwd: string, argv: string[], env: NodeJS.ProcessEnv = {}) {
  return Bun.spawnSync(argv, {
    cwd,
    env: {
      ...process.env,
      HUSKY: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function git(cwd: string, ...argv: string[]): string {
  const result = run(cwd, ["git", ...argv]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function status(generatedAt: string, effectiveStatus = "healthy") {
  return (
    JSON.stringify({
      schemaVersion: 1,
      generatedAt,
      providers: [{ id: "fixture", effectiveStatus, resolveMs: 1 }],
    }) + "\n"
  );
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kunai-status-publication-"));
  roots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  mkdirSync(repo);
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(repo, "init", "--initial-branch=main");
  git(repo, "config", "user.name", "fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "core.hooksPath", "/dev/null");
  git(repo, "remote", "add", "origin", remote);
  mkdirSync(dirname(join(repo, STATUS_PATH)), { recursive: true });
  writeFileSync(join(repo, STATUS_PATH), status("2026-10-01T00:00:00.000Z"));
  writeFileSync(join(repo, "runtime.txt"), "committed runtime\n");
  const publisher = join(ROOT, ".github/scripts/publish-provider-status.sh");
  if (existsSync(publisher)) {
    mkdirSync(join(repo, ".github/scripts"), { recursive: true });
    writeFileSync(
      join(repo, ".github/scripts/publish-provider-status.sh"),
      readFileSync(publisher),
    );
  }
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  git(repo, "push", "--set-upstream", "origin", "main");
  const bin = join(root, "bin");
  mkdirSync(bin);
  // The old workflow retries with sleep; replacing it avoids wall-clock waits
  // while reproducing the real dirty-worktree failure.
  writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "sleep"), 0o755);
  return { root, repo, remote, bin };
}

function publish(target: ReturnType<typeof fixture>, branch = "main", env: NodeJS.ProcessEnv = {}) {
  const step = WORKFLOW.split("      - name: Commit the status file if it changed\n")[1];
  if (!step) throw new Error("Status publication workflow step is missing");
  const source = step.startsWith("        run: |\n")
    ? step
        .slice("        run: |\n".length)
        .split("\n")
        .map((line) => line.replace(/^          /u, ""))
        .join("\n")
    : step.match(/^        run: (.+)/u)?.[1];
  if (!source) throw new Error("Status publication command is missing");
  return run(target.repo, ["bash", "-e", "-c", source], {
    GITHUB_REF_NAME: branch,
    PATH: `${target.bin}:${process.env.PATH}`,
    ...env,
  });
}

const describePublication = process.platform === "win32" ? describe.skip : describe;
describePublication("provider-status publication with real local Git", () => {
  test("publishes from a dirty probe checkout without committing or resetting runtime edits", () => {
    const target = fixture();
    const next = status("2026-10-03T00:00:00.000Z", "degraded");
    writeFileSync(join(target.repo, STATUS_PATH), next);
    writeFileSync(join(target.repo, "runtime.txt"), "dirty probe changes\n");
    const head = git(target.repo, "rev-parse", "HEAD");
    const before = git(target.repo, "status", "--porcelain");
    const result = publish(target);
    expect(result.exitCode).toBe(0);
    expect(git(target.remote, "show", `main:${STATUS_PATH}`)).toBe(next.trim());
    expect(git(target.repo, "rev-parse", "HEAD")).toBe(head);
    expect(git(target.repo, "status", "--porcelain")).toBe(before);
    expect(readFileSync(join(target.repo, "runtime.txt"), "utf8")).toBe("dirty probe changes\n");
    expect(git(target.repo, "worktree", "list", "--porcelain").match(/^worktree /gmu)).toHaveLength(
      1,
    );
  });

  test("publishes fresh observation time even when provider statuses are unchanged", () => {
    const target = fixture();
    const next = status("2026-10-03T00:00:00.000Z");
    writeFileSync(join(target.repo, STATUS_PATH), next);
    expect(publish(target).exitCode).toBe(0);
    expect(git(target.remote, "show", `main:${STATUS_PATH}`)).toBe(next.trim());
  });

  test("publishes only the status artifact and respects a manual-dispatch branch", () => {
    const target = fixture();
    git(target.repo, "switch", "-c", "preview");
    git(target.repo, "push", "--set-upstream", "origin", "preview");
    const mainHead = git(target.remote, "rev-parse", "main");
    writeFileSync(join(target.repo, STATUS_PATH), status("2026-10-03T00:00:00.000Z", "degraded"));
    expect(publish(target, "preview").exitCode).toBe(0);
    expect(git(target.remote, "rev-parse", "main")).toBe(mainHead);
    expect(git(target.remote, "diff-tree", "--no-commit-id", "--name-only", "-r", "preview")).toBe(
      STATUS_PATH,
    );
  });

  test("an identical observation is idempotent and an older observation cannot replace a newer one", () => {
    const target = fixture();
    const next = status("2026-10-03T00:00:00.000Z");
    writeFileSync(join(target.repo, STATUS_PATH), next);
    expect(publish(target).exitCode).toBe(0);
    const head = git(target.remote, "rev-parse", "main");
    expect(publish(target).exitCode).toBe(0);
    expect(git(target.remote, "rev-parse", "main")).toBe(head);
    writeFileSync(join(target.repo, STATUS_PATH), status("2026-10-02T00:00:00.000Z", "down"));
    expect(publish(target).exitCode).toBe(0);
    expect(git(target.remote, "rev-parse", "main")).toBe(head);
    expect(git(target.remote, "show", `main:${STATUS_PATH}`)).toBe(next.trim());
  });

  test("a branch advance during push is retried from the new head without losing its changes", () => {
    const target = fixture();
    const racer = join(target.root, "racer");
    git(target.root, "clone", target.remote, racer);
    git(racer, "config", "user.name", "fixture");
    git(racer, "config", "user.email", "fixture@example.invalid");
    writeFileSync(join(racer, "runtime.txt"), "concurrently committed runtime\n");
    git(racer, "add", "runtime.txt");
    git(racer, "commit", "-m", "concurrent branch advance");
    const hook = join(target.remote, "hooks/pre-receive");
    writeFileSync(
      hook,
      '#!/bin/sh\nset -eu\nif [ ! -f "$KUNAI_STATUS_RACER_DIR/pushed.flag" ]; then\n  touch "$KUNAI_STATUS_RACER_DIR/pushed.flag"\n  unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_QUARANTINE_PATH GIT_PREFIX\n  git -C "$KUNAI_STATUS_RACER_DIR" push origin main\nfi\n',
    );
    chmodSync(hook, 0o755);
    writeFileSync(join(target.repo, STATUS_PATH), status("2026-10-03T00:00:00.000Z", "degraded"));
    expect(publish(target, "main", { KUNAI_STATUS_RACER_DIR: racer }).exitCode).toBe(0);
    expect(existsSync(join(racer, "pushed.flag"))).toBe(true);
    expect(git(target.remote, "show", "main:runtime.txt")).toBe("concurrently committed runtime");
    expect(git(target.remote, "rev-list", "--count", "main")).toBe("3");
    expect(git(target.repo, "worktree", "list", "--porcelain").match(/^worktree /gmu)).toHaveLength(
      1,
    );
  });

  test("rejects malformed producer output and invalid branch names before publishing", () => {
    const target = fixture();
    const head = git(target.remote, "rev-parse", "main");
    writeFileSync(join(target.repo, STATUS_PATH), "{\n");
    expect(publish(target).exitCode).not.toBe(0);
    expect(git(target.remote, "rev-parse", "main")).toBe(head);
    expect(publish(target, "-invalid branch").exitCode).not.toBe(0);
    expect(git(target.repo, "worktree", "list", "--porcelain").match(/^worktree /gmu)).toHaveLength(
      1,
    );
  });

  test("bot commit and push do not run developer hooks or change shared hook configuration", () => {
    const target = fixture();
    const hooks = join(target.root, "blocking-hooks");
    mkdirSync(hooks);
    for (const name of ["pre-commit", "pre-push"]) {
      writeFileSync(join(hooks, name), "#!/bin/sh\nexit 99\n");
      chmodSync(join(hooks, name), 0o755);
    }
    git(target.repo, "config", "core.hooksPath", hooks);
    writeFileSync(join(target.repo, STATUS_PATH), status("2026-10-03T00:00:00.000Z"));
    expect(publish(target).exitCode).toBe(0);
    expect(git(target.repo, "config", "core.hooksPath")).toBe(hooks);
  });
});
