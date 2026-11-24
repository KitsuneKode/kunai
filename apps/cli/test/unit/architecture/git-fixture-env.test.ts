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
const STRIPS_GIT_ENV = /withoutGitEnv\(|key\.startsWith\(\s*["']GIT_["']\s*\)/;

test("tests that run git on a fixture never inherit the hook's GIT_* variables", () => {
  const offenders = [
    ...collectSourceFiles("apps", { extensions: [".ts", ".tsx"] }),
    ...collectSourceFiles("packages", { extensions: [".ts", ".tsx"] }),
  ]
    .filter((file) => /\/test\//.test(file) && !READS_REAL_CHECKOUT.has(file))
    .filter((file) => {
      const source = readRepoFile(file);
      return SPAWNS_GIT.test(source) && INHERITS_ENV.test(source) && !STRIPS_GIT_ENV.test(source);
    });
  expect(offenders).toEqual([]);
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
