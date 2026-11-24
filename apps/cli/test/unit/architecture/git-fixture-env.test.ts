import { expect, test } from "bun:test";

import { withoutGitEnv } from "../../helpers/git-env";
import { collectSourceFiles, readRepoFile } from "../../support/repo-scan";

/**
 * A test that spawns `git` with the parent environment inherits the
 * `GIT_DIR`/`GIT_WORK_TREE` a hook exports, and then writes to the real
 * repository instead of its fixture (see `helpers/git-env.ts`). Spawning git
 * with `...process.env` fails here unless the file also uses `withoutGitEnv`
 * or is listed below as only reading the real checkout on purpose.
 */
const READS_REAL_CHECKOUT = new Set([
  // `git rev-parse HEAD` of this checkout, for the README command harness.
  "apps/cli/test/integration/helpers/readme-command-harness.ts",
  // `git check-ignore` on this checkout's generated provenance file.
  "apps/docs/test/codegen-idempotence.test.ts",
]);

const SPAWNS_GIT = /\[\s*["']git["']|spawn(?:Sync)?\(\s*["']git["']/;
const INHERITS_ENV = /\.\.\.process\.env\b/;
const ALLOW = "// git-env-allow:";

/**
 * In a file that runs git, every `...process.env` spread is checked on its own:
 * one safe spawn must not vouch for another. A spread that deliberately keeps
 * the parent environment needs `// git-env-allow: <reason>` on the line above.
 */
export function unsafeEnvSpreads(source: string): number[] {
  if (!SPAWNS_GIT.test(source)) return [];
  const lines = source.split("\n");
  const offenders: number[] = [];
  lines.forEach((line, index) => {
    if (!INHERITS_ENV.test(line) || line.trim().startsWith("//")) return;
    let previous = "";
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      previous = (lines[cursor] ?? "").trim();
      if (previous.length > 0) break;
    }
    if (previous.startsWith(ALLOW) && previous.slice(ALLOW.length).trim()) return;
    offenders.push(index + 1);
  });
  return offenders;
}

test("tests that run git on a fixture never inherit the hook's GIT_* variables", () => {
  const offenders = [
    ...collectSourceFiles("apps", { extensions: [".ts", ".tsx"] }),
    ...collectSourceFiles("packages", { extensions: [".ts", ".tsx"] }),
  ]
    .filter((file) => /\/test\//.test(file) && !READS_REAL_CHECKOUT.has(file))
    .filter((file) => !file.endsWith("git-fixture-env.test.ts"))
    .flatMap((file) => unsafeEnvSpreads(readRepoFile(file)).map((line) => `${file}:${line}`));
  expect(offenders).toEqual([]);
});

test("each env spread is judged on its own, not by the rest of the file", () => {
  const safeAndUnsafe = [
    'Bun.spawnSync(["git", "init"], { env: { ...withoutGitEnv() } });',
    'Bun.spawnSync(["git", "commit"], { env: { ...process.env } });',
  ].join("\n");
  expect(unsafeEnvSpreads(safeAndUnsafe)).toEqual([2]);
  expect(
    unsafeEnvSpreads(
      'Bun.spawnSync(["git", "log"]);\n// git-env-allow: points GIT_DIR at a fixture on purpose\nconst env = { ...process.env, GIT_DIR: dir };',
    ),
  ).toEqual([]);
  expect(unsafeEnvSpreads("const env = { ...process.env };")).toEqual([]);
});

test("withoutGitEnv drops every GIT_ variable and keeps the rest", () => {
  expect(
    withoutGitEnv({
      GIT_DIR: "/repo/.git/worktrees/x",
      GIT_WORK_TREE: "/repo",
      GIT_INDEX_FILE: "/repo/.git/index",
      PATH: "/usr/bin",
      HOME: "/tmp/home",
    }),
  ).toEqual({ PATH: "/usr/bin", HOME: "/tmp/home" });
});
