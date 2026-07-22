import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The npm `bin` launcher must run under plain Node.
 *
 * `bin` used to point at the whole Bun-compiled app (`#!/usr/bin/env bun`, with
 * `bun:` imports), so `npm install -g @kitsunekode/kunai` — advertised as the
 * alternative TO Bun — produced a command that could not start without it. These
 * tests run the launcher with `node` and a PATH that has no `bun` on it.
 *
 * The child is a stand-in binary placed in the vendor fallback location, so the
 * launcher's own contract (resolution, exit-code passthrough, signal semantics)
 * is tested without depending on the real app's startup behavior.
 */
const LAUNCHER_SOURCE = join(import.meta.dirname, "../../scripts/npm-launcher.mjs");
const NO_BUN_PATH = "/usr/bin:/bin";

let workDir = "";
let launcher = "";

function targetIdForHost(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return `windows-${arch}`;
  return `linux-${arch}`;
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "kunai-launcher-"));
  mkdirSync(join(workDir, "dist"), { recursive: true });
  launcher = join(workDir, "dist", "kunai.mjs");
  writeFileSync(launcher, readFileSync(LAUNCHER_SOURCE, "utf8"));

  const binDir = join(workDir, "vendor", targetIdForHost(), "bin");
  mkdirSync(binDir, { recursive: true });
  const stand = join(binDir, process.platform === "win32" ? "kunai.exe" : "kunai");
  writeFileSync(
    stand,
    `#!/usr/bin/env node
const code = process.argv.indexOf("--exit-code");
if (code !== -1) process.exit(Number(process.argv[code + 1] ?? 0));
if (process.argv.includes("--echo-args")) {
  process.stdout.write(process.argv.slice(2).join(","));
  process.exit(0);
}
setTimeout(() => {}, 30000);
`,
  );
  chmodSync(stand, 0o755);
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function runLauncher(args: readonly string[]) {
  return Bun.spawnSync({
    cmd: ["node", launcher, ...args],
    env: { ...process.env, PATH: NO_BUN_PATH },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("launcher is plain Node ESM with a node shebang and no bun: imports", () => {
  const source = readFileSync(LAUNCHER_SOURCE, "utf8");
  expect(source.startsWith("#!/usr/bin/env node")).toBe(true);
  expect(/from\s+["']bun:|require\(["']bun:/.test(source)).toBe(false);
});

test("runs under node with no bun on PATH", () => {
  expect(
    Bun.spawnSync({ cmd: ["sh", "-c", "command -v bun"], env: { PATH: NO_BUN_PATH } }).exitCode,
  ).not.toBe(0);

  const result = runLauncher(["--echo-args", "hello"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("--echo-args,hello");
});

test("passes the child's exit code through unchanged", () => {
  expect(runLauncher(["--exit-code", "0"]).exitCode).toBe(0);
  expect(runLauncher(["--exit-code", "42"]).exitCode).toBe(42);
});

test("reports an actionable error when the platform binary is missing", () => {
  const empty = mkdtempSync(join(tmpdir(), "kunai-launcher-empty-"));
  mkdirSync(join(empty, "dist"), { recursive: true });
  const lonely = join(empty, "dist", "kunai.mjs");
  writeFileSync(lonely, readFileSync(LAUNCHER_SOURCE, "utf8"));

  const result = Bun.spawnSync({
    cmd: ["node", lonely],
    env: { ...process.env, PATH: NO_BUN_PATH },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = result.stderr.toString();

  expect(result.exitCode).toBe(1);
  expect(stderr).toContain("@kitsunekode/kunai-");
  // Must name a way out, not just fail.
  expect(stderr).toMatch(/install -g|add -g/);
  expect(stderr).toContain("install.sh");

  rmSync(empty, { recursive: true, force: true });
});

// Signal semantics are POSIX-only.
const signalTest = process.platform === "win32" ? test.skip : test;

signalTest("dies by the same signal as the child, giving 128+n", async () => {
  for (const [signal, expected] of [
    ["SIGINT", 130],
    ["SIGHUP", 129],
  ] as const) {
    const child = Bun.spawn({
      cmd: ["node", launcher],
      env: { ...process.env, PATH: NO_BUN_PATH },
      stdout: "ignore",
      stderr: "ignore",
    });
    await Bun.sleep(400);
    process.kill(child.pid, signal);
    // Re-raising while a handler is still registered makes Node run the handler
    // instead of terminating — the launcher removes it first, and this pins that.
    expect(await child.exited, signal).toBe(expected);
  }
});
