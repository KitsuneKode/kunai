/**
 * Default CLI test entry for `bun run test`.
 *
 * When Turborepo orchestrates `test` with `dependsOn: ["test:unit",
 * "test:integration"]`, those suites already ran — exit immediately so the
 * aggregator task does not re-execute the same work.
 *
 * Direct invocation (`bun run --cwd apps/cli test`) runs both suites
 * sequentially. Extra args after `--`:
 * - path/file filters replace the default suite dirs (so a single file stays
 *   focused)
 * - flag-only args append to `bun test test/unit test/integration`
 */
import { join } from "node:path";

if (process.env.TURBO_HASH) {
  process.exit(0);
}

const cwd = join(import.meta.dir, "..");
const extraArgs = process.argv.slice(2);

/**
 * Per-test timeout override, in milliseconds.
 *
 * Bun's default is 5s, which is ample everywhere except the Windows CI runner:
 * the SQLite-backed suites open a fresh database per test, and the shared temp
 * store registry pays a synchronous full GC per teardown to make Windows
 * actually release the file handles. Under full-suite load that occasionally
 * pushes a single test past 5s, and *which* test loses varies run to run.
 *
 * Raising the bound rather than special-casing tests keeps a genuine hang
 * failing — the job's own step timeout is the real ceiling.
 */
const timeoutMs = process.env.KUNAI_TEST_TIMEOUT_MS;
const timeoutArgs = timeoutMs ? ["--", `--timeout=${timeoutMs}`] : [];

async function run(cmd: string[]): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return await proc.exited;
}

if (extraArgs.length > 0) {
  const hasPathFilter = extraArgs.some((arg) => !arg.startsWith("-"));
  const cmd = hasPathFilter
    ? ["bun", "test", ...extraArgs]
    : ["bun", "test", "test/unit", "test/integration", ...extraArgs];
  process.exit(await run(cmd));
}

const unitCode = await run(["bun", "run", "test:unit", ...timeoutArgs]);
if (unitCode !== 0) {
  process.exit(unitCode);
}

process.exit(await run(["bun", "run", "test:integration", ...timeoutArgs]));
