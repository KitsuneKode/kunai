import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../../../.github/scripts/open-release-metadata-pr.sh");

for (const scenario of [
  "new",
  "pushed",
  "open",
  "merged",
  "closed",
  "staged",
  "unchanged",
  "api-failure",
] as const) {
  test.skipIf(process.platform === "win32")(
    `release metadata review preserves main: ${scenario}`,
    () => {
      const root = mkdtempSync(join(tmpdir(), "kunai-metadata-pr-"));
      const repo = join(root, "repo");
      const remote = join(root, "remote.git");
      mkdirSync(repo);
      const env = {
        ...process.env,
        HUSKY: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.test",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.test",
        GITHUB_RUN_ID: "123",
        GITHUB_REPOSITORY: "fixture/repo",
        PATH: `${root}:${process.env.PATH}`,
      };
      function git(...args: string[]) {
        const result = Bun.spawnSync(["git", ...args], {
          cwd: repo,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (result.exitCode !== 0) throw new Error(result.stderr.toString());
        return result.stdout.toString().trim();
      }
      try {
        git("init", "--bare", remote);
        git("init", "-b", "main");
        git("config", "commit.gpgsign", "false");
        mkdirSync(join(repo, ".release"));
        writeFileSync(join(repo, ".release/kunai-v1.2.3.json"), '{"status":"staged"}\n');
        git("add", ".");
        git("commit", "-m", "fixture");
        git("remote", "add", "origin", remote);
        git("push", "origin", "main");
        const before = git("rev-parse", "HEAD");
        writeFileSync(
          join(root, "gh"),
          `#!/bin/sh\nif [ "$2" = "list" ]; then exit 0; fi\nprintf '%s\\n' "$@" > '${root}/gh-args'\n`,
        );
        chmodSync(join(root, "gh"), 0o755);
        writeFileSync(join(repo, ".release/kunai-v1.2.3.json"), '{"status":"published"}\n');
        writeFileSync(join(repo, "unrelated.txt"), "not part of release metadata");
        const branch = "release/published-v1.2.3-123";
        if (scenario === "pushed") {
          git("switch", "-c", branch);
          git("add", ".release/kunai-v1.2.3.json");
          git("commit", "-m", "interrupted metadata job");
          git("push", "origin", branch);
          git("switch", "main");
        }
        if (scenario === "staged") git("add", "unrelated.txt");
        if (scenario === "unchanged") git("restore", ".release/kunai-v1.2.3.json");
        if (["open", "merged", "closed"].includes(scenario)) {
          writeFileSync(
            join(root, "gh"),
            `#!/bin/sh\nif [ "$2" = "list" ]; then printf '%s\\t%s\\n' '${scenario.toUpperCase()}' 'https://example.test/pr/1'; else exit 99; fi\n`,
          );
        }
        if (scenario === "api-failure") writeFileSync(join(root, "gh"), "#!/bin/sh\nexit 42\n");
        const result = Bun.spawnSync(["bash", script, "1.2.3"], {
          cwd: repo,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(result.stderr.toString()).not.toContain("error:");
        expect(result.exitCode).toBe(
          scenario === "api-failure" ? 42 : ["closed", "staged"].includes(scenario) ? 1 : 0,
        );
        expect(git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(before);
        if (scenario !== "new" && scenario !== "pushed") {
          expect(git("ls-remote", "origin", `refs/heads/${branch}`)).toBe("");
          expect(git("rev-parse", "HEAD")).toBe(before);
          return;
        }
        expect(git("ls-remote", "origin", `refs/heads/${branch}`)).toContain(branch);
        expect(git("diff", "--name-only", before, branch)).toBe(".release/kunai-v1.2.3.json");
        const args = readFileSync(join(root, "gh-args"), "utf8").split("\n");
        expect(args.slice(0, 2)).toEqual(["pr", "create"]);
        expect(args[args.indexOf("--base") + 1]).toBe("main");
        expect(args[args.indexOf("--head") + 1]).toBe(branch);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}
