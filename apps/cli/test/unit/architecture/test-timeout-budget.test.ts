import { expect, test } from "bun:test";
import { resolve } from "node:path";

/**
 * Bun's default per-test timeout is 5000ms. That is too low for the docs
 * idempotence test, which runs code generation twice under parallel Turbo load,
 * and for the Windows runner, where the SQLite-backed suites open a fresh
 * database per test and the temp-store registry forces a synchronous full GC
 * per teardown so Windows actually releases the file handles. One storage test
 * was measured at 6428ms on one run and 16549ms on the next.
 *
 * The budget therefore has to live on the suite scripts, because that is the one
 * place every caller shares: Turborepo runs `test:unit` / `test:integration`
 * directly (`run-default-tests.ts` exits early under `TURBO_HASH`), the Windows
 * job invokes the package script, and the husky pre-push hook goes through
 * turbo too. A per-file `jest.setTimeout` covers none of those uniformly, and a
 * `bunfig.toml` `[test] timeout` is ignored outright by Bun 1.3.14.
 *
 * This test exists so the flag cannot be dropped silently — losing it turns
 * every slow-platform run back into a coin flip.
 */

const MINIMUM_TIMEOUT_MS = 20_000;

async function scriptsOf(relativePath: string): Promise<Record<string, string>> {
  const pkg = (await Bun.file(resolve(import.meta.dir, relativePath)).json()) as {
    readonly scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

function timeoutOf(script: string): number | null {
  const match = /--timeout[= ](\d+)/.exec(script);
  return match?.[1] ? Number(match[1]) : null;
}

test("suite scripts that touch SQLite or spawn shells carry an explicit per-test timeout", async () => {
  const cli = await scriptsOf("../../../package.json");
  const docs = await scriptsOf("../../../../docs/package.json");
  const storage = await scriptsOf("../../../../../packages/storage/package.json");

  const budgeted: ReadonlyArray<readonly [string, string | undefined]> = [
    ["apps/cli test:unit", cli["test:unit"]],
    ["apps/cli test:integration", cli["test:integration"]],
    ["apps/docs test", docs.test],
    ["packages/storage test", storage.test],
  ];

  for (const [label, script] of budgeted) {
    expect(script, `${label} must exist`).toBeString();
    const timeout = timeoutOf(script ?? "");
    expect(timeout, `${label} must set --timeout explicitly`).not.toBeNull();
    expect(timeout, `${label} must exceed Bun's 5000ms default`).toBeGreaterThanOrEqual(
      MINIMUM_TIMEOUT_MS,
    );
  }
});

test("the default test runner still lets CI override the scripted budget", async () => {
  const runner = await Bun.file(
    resolve(import.meta.dir, "../../../scripts/run-default-tests.ts"),
  ).text();

  // Bun applies the last --timeout on the command line, so the runner appending
  // the env override after the scripted baseline is what makes CI's value win.
  expect(runner).toContain("KUNAI_TEST_TIMEOUT_MS");
  expect(runner).toContain("--timeout=");
});
