import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The publish path of the provider sweep, run against real throwaway git remotes.
 *
 * The old workflow committed to `main` and rebased, and was refused every day for
 * three days with "cannot rebase: You have unstaged changes". Nothing noticed,
 * because the job's only visible effect is a file that stops changing. These tests
 * exist so that failure is a red test, including that exact case: a dirty working
 * tree in the repository the sweep runs from.
 */

const SCRIPT = path.resolve(import.meta.dir, "../scripts/status-data-branch.sh");

function sh(cwd: string, args: readonly string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync([...args], {
    cwd,
    env: {
      ...process.env,
      // The user's and the system's git config stay out of it: a global
      // `commit.gpgsign`, a hooks path or an alias would otherwise decide whether
      // these tests pass on a given machine.
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.test",
      ...env,
    },
  });
  return {
    code: result.exitCode,
    out: result.stdout.toString().trim(),
    err: result.stderr.toString().trim(),
  };
}

function git(cwd: string, ...args: string[]) {
  const result = sh(cwd, ["git", ...args]);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.err}`);
  return result.out;
}

let root: string;
let origin: string;
let work: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), ".cache", "status-data-test-"));
  origin = path.join(root, "origin.git");
  work = path.join(root, "work");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  git(root, "clone", "--quiet", origin, work);
  fs.writeFileSync(path.join(work, "code.txt"), "the code\n");
  git(work, "add", "code.txt");
  git(work, "commit", "--quiet", "-m", "main: code");
  git(work, "push", "--quiet", "origin", "HEAD:refs/heads/main");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function checkout(dir: string) {
  return sh(work, ["bash", SCRIPT, "checkout", dir]);
}

function publish(dir: string, message: string) {
  return sh(work, ["bash", SCRIPT, "publish", dir, message]);
}

describe("status-data branch", () => {
  test("the first run creates an orphan branch holding only the data", () => {
    const dir = path.join(root, "first");
    expect(checkout(dir).code).toBe(0);
    // Nothing from main leaks into the data branch.
    expect(fs.existsSync(path.join(dir, "code.txt"))).toBe(false);

    fs.writeFileSync(path.join(dir, "generated-provider-status.json"), '{"day":1}\n');
    const result = publish(dir, "chore(status): sweep one");
    expect(result.code).toBe(0);

    expect(git(root, "--git-dir", origin, "ls-tree", "--name-only", "status-data")).toBe(
      "generated-provider-status.json",
    );
    // An orphan: its history does not include main's.
    expect(git(root, "--git-dir", origin, "rev-list", "--count", "status-data")).toBe("1");
  });

  test("the second run starts from yesterday's files and adds a commit", () => {
    const dir = path.join(root, "second");
    expect(checkout(dir).code).toBe(0);
    // The sweep reads the previous history from here, so it must already be present.
    expect(fs.readFileSync(path.join(dir, "generated-provider-status.json"), "utf8")).toBe(
      '{"day":1}\n',
    );

    fs.writeFileSync(path.join(dir, "generated-provider-status.json"), '{"day":2}\n');
    fs.writeFileSync(path.join(dir, "generated-provider-status-history.json"), "[1,2]\n");
    expect(publish(dir, "chore(status): sweep two").code).toBe(0);

    expect(git(root, "--git-dir", origin, "rev-list", "--count", "status-data")).toBe("2");
    expect(
      git(root, "--git-dir", origin, "show", "status-data:generated-provider-status.json"),
    ).toBe('{"day":2}');
  });

  test("publishing with nothing changed adds no commit and does not fail", () => {
    const dir = path.join(root, "quiet");
    expect(checkout(dir).code).toBe(0);
    const result = publish(dir, "chore(status): nothing");
    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing to publish");
    expect(git(root, "--git-dir", origin, "rev-list", "--count", "status-data")).toBe("2");
  });

  test("a dirty working tree in the repository does not get in the way", () => {
    // This is the failure that stopped the old workflow: unstaged changes in the checkout
    // (an install step rewriting a tracked file) made the rebase refuse.
    fs.writeFileSync(path.join(work, "code.txt"), "the code, modified by an install step\n");
    expect(git(work, "status", "--porcelain")).toContain("code.txt");

    const dir = path.join(root, "dirty");
    expect(checkout(dir).code).toBe(0);
    fs.writeFileSync(path.join(dir, "generated-provider-status.json"), '{"day":3}\n');
    const result = publish(dir, "chore(status): sweep three");
    expect(result.code).toBe(0);

    expect(git(root, "--git-dir", origin, "rev-list", "--count", "status-data")).toBe("3");
    // And the caller's dirty file is exactly as it was left.
    expect(fs.readFileSync(path.join(work, "code.txt"), "utf8")).toContain(
      "modified by an install",
    );
    git(work, "checkout", "--", "code.txt");
  });

  test("main is never touched", () => {
    expect(git(root, "--git-dir", origin, "rev-list", "--count", "main")).toBe("1");
  });

  test("a push refused because someone else published meanwhile rebases and lands", () => {
    const dir = path.join(root, "raced");
    expect(checkout(dir).code).toBe(0);

    // A maintainer posts a notice while the sweep is running.
    const other = path.join(root, "maintainer");
    expect(checkout(other).code).toBe(0);
    fs.writeFileSync(path.join(other, "status-notices.json"), '{"notices":[]}\n');
    expect(publish(other, "notice: posted").code).toBe(0);

    fs.writeFileSync(path.join(dir, "generated-provider-status.json"), '{"day":4}\n');
    const result = publish(dir, "chore(status): sweep four");
    expect(result.code).toBe(0);

    const files = git(root, "--git-dir", origin, "ls-tree", "--name-only", "status-data").split(
      "\n",
    );
    // Both writers' work is on the branch.
    expect(files).toContain("status-notices.json");
    expect(
      git(root, "--git-dir", origin, "show", "status-data:generated-provider-status.json"),
    ).toBe('{"day":4}');
  });

  test("a missing argument is a usage error, not a half-run", () => {
    expect(sh(work, ["bash", SCRIPT]).code).toBe(2);
    expect(sh(work, ["bash", SCRIPT, "publish", path.join(root, "x")]).code).toBe(2);
  });
});
