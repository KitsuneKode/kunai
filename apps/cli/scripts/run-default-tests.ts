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
  // Values of Bun options are not positional test-file patterns. Keep this
  // list aligned with `bun test --help` when upgrading the pinned runtime.
  const valueOptions = new Set([
    "-t",
    "--test-name-pattern",
    "--timeout",
    "--rerun-each",
    "--retry",
    "--seed",
    "--coverage-reporter",
    "--coverage-dir",
    "--reporter",
    "--reporter-outfile",
    "--max-concurrency",
    "--path-ignore-patterns",
    "--parallel-delay",
    "--shard",
    "--timings",
    "--preload",
    "-r",
  ]);
  const optionalValueOptions = new Set(["--bail", "--parallel", "--changed"]);
  let hasPathFilter = false;
  for (let index = 0; index < extraArgs.length; index += 1) {
    const arg = extraArgs[index];
    if (arg === undefined) break;
    if (arg === "--") {
      hasPathFilter = index + 1 < extraArgs.length;
      break;
    }
    if (valueOptions.has(arg)) {
      index += 1;
    } else if (optionalValueOptions.has(arg)) {
      const next = extraArgs[index + 1];
      // Bun accepts a separate numeric value for bail/parallel; --changed
      // accepts a revision. Use --changed=<revision> when mixing file filters.
      if (next && !next.startsWith("-") && (arg === "--changed" || /^\d+$/.test(next))) index += 1;
    } else if (!arg.startsWith("-")) {
      hasPathFilter = true;
      break;
    }
  }
  const cmd = hasPathFilter
    ? ["bun", "test", ...extraArgs]
    : ["bun", "test", "test/unit", "test/integration", ...extraArgs];
  // Explicit CLI flags override the baseline; CI's environment override wins
  // last, matching the no-argument suite path.
  cmd.splice(2, 0, "--timeout=20000");
  if (timeoutMs) {
    const separator = cmd.indexOf("--", 2);
    cmd.splice(separator < 0 ? cmd.length : separator, 0, `--timeout=${timeoutMs}`);
  }
  process.exit(await run(cmd));
}

const unitCode = await run(["bun", "run", "test:unit", ...timeoutArgs]);
if (unitCode !== 0) {
  process.exit(unitCode);
}

process.exit(await run(["bun", "run", "test:integration", ...timeoutArgs]));
