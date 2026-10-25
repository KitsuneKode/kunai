import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { storageRootEnv } from "../../helpers/storage-env";

const verifier = resolve(import.meta.dir, "../../../../../scripts/verify-doc-frontmatter.ts");

function doc(reviewed: string, body: string): string {
  return `---\nstatus: current\nlastReviewed: "${reviewed}"\n---\n\n# Fixture\n\n> Agent-facing (L3).\n\n${body}\n`;
}

for (const scenario of [
  {
    name: "formatter-only list indentation does not invent a new review date",
    before: "2026-10-11",
    after: "2026-10-11",
    beforeBody: "- `command\nargument`",
    afterBody: "- `command\n  argument`",
    exit: 0,
  },
  {
    name: "formatting plus a content edit still needs review",
    before: "2026-10-11",
    after: "2026-10-11",
    beforeBody: "- `command\nargument`",
    afterBody: "- `command\n  changed-argument`",
    exit: 1,
  },
  {
    name: "a second review on the same day can use an ISO timestamp",
    before: "2026-10-11",
    after: "2026-10-11T12:05:00Z",
    exit: 0,
  },
  {
    name: "an unchanged review date still rejects edited content",
    before: "2026-10-11",
    after: "2026-10-11",
    exit: 1,
  },
  {
    name: "an unchanged review timestamp still rejects edited content",
    before: "2026-10-11T12:05:00Z",
    after: "2026-10-11T12:05:00Z",
    exit: 1,
  },
  {
    name: "an impossible calendar date is rejected",
    before: "2026-10-11",
    after: "2026-02-30",
    exit: 1,
  },
  {
    name: "a malformed review timestamp is rejected",
    before: "2026-10-11",
    after: "2026-10-11T99:05:00Z",
    exit: 1,
  },
]) {
  test(scenario.name, () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-doc-freshness-"));
    const env = {
      ...process.env,
      ...storageRootEnv(root),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
    };
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, ".docs"));
      copyFileSync(verifier, join(root, "scripts/verify-doc-frontmatter.ts"));
      const target = join(root, ".docs/fixture.md");
      writeFileSync(target, doc(scenario.before, scenario.beforeBody ?? "Before."));
      const git = (...args: string[]) => {
        const result = Bun.spawnSync(["git", ...args], {
          cwd: root,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(result.exitCode).toBe(0);
        return result.stdout.toString().trim();
      };
      git("init", "--quiet");
      git("add", ".");
      const commit = (message: string) =>
        git(
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--quiet",
          "-m",
          message,
        );
      commit("before");
      const base = git("rev-parse", "HEAD");
      writeFileSync(target, doc(scenario.after, scenario.afterBody ?? "Changed behavior."));
      git("add", ".");
      commit("after");
      const result = Bun.spawnSync([process.execPath, "scripts/verify-doc-frontmatter.ts"], {
        cwd: root,
        env: { ...env, DOC_FRESHNESS_BASE: base, SKIP_DOC_FRESHNESS: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect({
        exit: result.exitCode,
        error: result.exitCode === scenario.exit ? "" : result.stderr.toString(),
      }).toEqual({ exit: scenario.exit, error: "" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
