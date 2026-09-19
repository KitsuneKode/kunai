import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kunai-test-runner-"));
  await mkdir(join(root, "scripts"));
  await Bun.write(
    join(root, "observe-spawn.ts"),
    `
    const spawn = Bun.spawn;
    Bun.spawn = function(cmd, options) {
      console.log("SPAWN=" + JSON.stringify(cmd));
      return spawn(cmd, options);
    };
  `,
  );
  await Bun.write(
    join(root, "scripts/run-default-tests.ts"),
    Bun.file(resolve(import.meta.dir, "../../../scripts/run-default-tests.ts")),
  );
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({
      scripts: {
        "test:unit": "bun test test/unit --timeout=20000",
        "test:integration": "bun test test/integration --timeout=20000",
      },
    }),
  );
  for (const lane of ["unit", "integration", "outside"]) {
    await mkdir(join(root, "test", lane), { recursive: true });
    await Bun.write(
      join(root, "test", lane, "probe.test.ts"),
      `import {test} from "bun:test"; test("selected probe", () => { console.log("EXECUTED_${lane}"); });`,
    );
  }
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function run(args: string[] = [], overrides: Record<string, string> = {}) {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "--preload",
      "./observe-spawn.ts",
      "scripts/run-default-tests.ts",
      ...args,
    ],
    {
      cwd: root,
      env: { ...process.env, TURBO_HASH: "", KUNAI_TEST_TIMEOUT_MS: "", ...overrides },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { output: stdout + stderr, code };
}

for (const args of [
  [],
  ["-t", "selected probe"],
  ["--test-name-pattern=selected probe"],
  ["--timeout", "20000"],
]) {
  test(`default discovery stays in unit and integration: ${JSON.stringify(args)}`, async () => {
    const result = await run(args);
    expect(result.code).toBe(0);
    expect(result.output).toContain("EXECUTED_unit");
    expect(result.output).toContain("EXECUTED_integration");
    expect(result.output).not.toContain("EXECUTED_outside");
  });
}

test("explicit file patterns stay focused", async () => {
  const result = await run(["test/unit/probe.test.ts", "-t", "selected probe"]);
  expect(result.code).toBe(0);
  expect(result.output).toContain("EXECUTED_unit");
  expect(result.output).not.toContain("EXECUTED_integration");
});

test("Turbo aggregator does not execute suites twice", async () => {
  const result = await run([], { TURBO_HASH: "orchestrated" });
  expect(result.code).toBe(0);
  expect(result.output).not.toContain("EXECUTED_");
});

test("default suite failure stops before integration and propagates exit status", async () => {
  await Bun.write(
    join(root, "test/unit/probe.test.ts"),
    'import {test} from "bun:test"; test("failure", () => {throw new Error("expected fixture failure")});',
  );
  const result = await run();
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("expected fixture failure");
  expect(result.output).not.toContain("EXECUTED_integration");
});

for (const [args, env, expected] of [
  [["test/unit/probe.test.ts"], {}, ["--timeout=20000"]],
  [["test/unit/probe.test.ts", "--timeout=12345"], {}, ["--timeout=20000", "--timeout=12345"]],
  [
    ["test/unit/probe.test.ts", "--timeout=12345"],
    { KUNAI_TEST_TIMEOUT_MS: "23456" },
    ["--timeout=20000", "--timeout=12345", "--timeout=23456"],
  ],
] as const) {
  test(`focused timeout precedence: ${JSON.stringify({ args, env })}`, async () => {
    const result = await run([...args], env);
    expect(result.code).toBe(0);
    const spawnLine = result.output.split(/\r?\n/).find((line) => line.startsWith("SPAWN="));
    const argv = JSON.parse(spawnLine!.slice(6)) as string[];
    expect(argv.filter((arg) => arg.startsWith("--timeout="))).toEqual([...expected]);
  });
}
