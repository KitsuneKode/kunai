import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeTempDir } from "../support/remove-temp-dir";

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

let workDir = "";
let launcher = "";
/**
 * PATH that reaches `node` but not `bun`.
 *
 * Built from a directory we populate ourselves rather than hardcoded system
 * directories: "bun is absent" then holds by construction on any image, and
 * `node` stays reachable wherever it happens to live. Hardcoding `/usr/bin:/bin`
 * silently passed on distros that ship `/usr/bin/node` and failed on GitHub's
 * Ubuntu runners, which install Node under `/usr/local/bin`.
 *
 * The stand-in child resolves `node` through this PATH too, via its
 * `#!/usr/bin/env node` shebang.
 */
let noBunPath = "";

function targetIdForHost(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return `windows-${arch}`;
  return `linux-${arch}`;
}

/**
 * These tests exist to prove the launcher runs under plain Node, so Node is a
 * prerequisite rather than something they can assert. Throwing in `beforeAll`
 * when it is absent reported an unnamed failure with no useful location on any
 * machine without Node; skipping says what is actually missing. CI installs
 * Node, so coverage there is unchanged.
 */
const NODE_BIN = Bun.which("node");
const nodeTest = NODE_BIN ? test : test.skip;
const WINDOWS_LAUNCHER_BINARY = process.env.KUNAI_NPM_LAUNCHER_BINARY;
const windowsNativeLauncherTest =
  NODE_BIN && process.platform === "win32" && WINDOWS_LAUNCHER_BINARY ? test : test.skip;

/**
 * Cases that actually execute the stand-in child are POSIX-only.
 *
 * The stand-in is a `#!/usr/bin/env node` text file, and the launcher spawns the
 * platform binary directly (`spawn(binaryPath, ...)`, no shell — deliberately,
 * so signals reach mpv). Windows has no shebang: it needs a real PE executable,
 * and Node refuses to spawn `.cmd`/`.bat` without a shell. So these fail on
 * Windows for a reason that has nothing to do with the launcher's contract.
 *
 * They were not merely skipped before — they *failed*, but only where `node` is
 * on PATH, so a shell without it reported a tidy all-skipped run and the real
 * result only appeared under CI. Gating says what is true.
 *
 * The real Windows execution path uses the opt-in PE fixture below. CI gives it
 * the host binary after building it, so Node stages that exact executable in
 * the vendor layout and runs it with Bun absent from PATH.
 */
const execTest = NODE_BIN && process.platform !== "win32" ? test : test.skip;

beforeAll(() => {
  if (!NODE_BIN) return;
  // realpath, not the raw mkdtemp path. On macOS `/var` is a symlink to
  // `/private/var`, so `tmpdir()` hands back `/var/folders/...` while anything
  // that resolves the path — as the launcher does when it records an absolute
  // package root — reports `/private/var/folders/...`. Comparing the two fails
  // only on macOS. Resolving here is a no-op on Linux and Windows.
  workDir = realpathSync(mkdtempSync(join(tmpdir(), "kunai-launcher-")));

  const nodeBin = NODE_BIN;
  noBunPath = join(workDir, "no-bun-bin");
  mkdirSync(noBunPath, { recursive: true });
  // Copy rather than symlink on Windows: creating a symlink there needs
  // Developer Mode or elevation, which a CI runner does not have. The point is
  // only a PATH directory that has node and no bun — a copy satisfies that.
  if (process.platform === "win32") {
    copyFileSync(nodeBin, join(noBunPath, "node.exe"));
  } else {
    symlinkSync(nodeBin, join(noBunPath, "node"));
  }

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
  removeTempDir(workDir);
});

function runLauncher(args: readonly string[]) {
  return Bun.spawnSync({
    cmd: ["node", launcher, ...args],
    env: { ...process.env, PATH: noBunPath },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function createNativeWindowsLauncherFixture(binary: string): {
  readonly launcher: string;
  readonly packageRoot: string;
} {
  const packageRoot = mkdtempSync(join(tmpdir(), "kunai-windows-launcher-"));
  const fixtureLauncher = join(packageRoot, "dist", "kunai.mjs");
  const fixtureBinary = join(packageRoot, "vendor", "windows-x64", "bin", "kunai.exe");
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  mkdirSync(join(packageRoot, "vendor", "windows-x64", "bin"), { recursive: true });
  writeFileSync(fixtureLauncher, readFileSync(LAUNCHER_SOURCE, "utf8"));
  copyFileSync(binary, fixtureBinary);
  return { launcher: fixtureLauncher, packageRoot };
}

function createLauncherFixture(packageRoot: string): string {
  const fixtureLauncher = join(packageRoot, "dist", "kunai.mjs");
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeFileSync(fixtureLauncher, readFileSync(LAUNCHER_SOURCE, "utf8"));

  const binDir = join(packageRoot, "vendor", targetIdForHost(), "bin");
  mkdirSync(binDir, { recursive: true });
  const stand = join(binDir, process.platform === "win32" ? "kunai.exe" : "kunai");
  writeFileSync(
    stand,
    `#!/usr/bin/env node
if (process.argv.includes("--echo-managed-context")) {
  process.stdout.write(JSON.stringify({
    manager: process.env.KUNAI_MANAGED_PACKAGE_MANAGER,
    packageRoot: process.env.KUNAI_MANAGED_PACKAGE_ROOT,
    unrelated: process.env.KUNAI_LAUNCHER_TEST_UNRELATED,
  }));
}
`,
  );
  chmodSync(stand, 0o755);
  return fixtureLauncher;
}

function readManagedContext(fixtureLauncher: string, unrelated = "preserved") {
  const result = Bun.spawnSync({
    cmd: ["node", fixtureLauncher, "--echo-managed-context"],
    env: {
      ...process.env,
      PATH: noBunPath,
      KUNAI_LAUNCHER_TEST_UNRELATED: unrelated,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString()) as {
    manager?: string;
    packageRoot?: string;
    unrelated?: string;
  };
}

nodeTest("launcher is plain Node ESM with a node shebang and no bun: imports", () => {
  const source = readFileSync(LAUNCHER_SOURCE, "utf8");
  expect(source.startsWith("#!/usr/bin/env node")).toBe(true);
  expect(/from\s+["']bun:|require\(["']bun:/.test(source)).toBe(false);
});

execTest("runs under node with no bun on PATH", () => {
  // Guards the premise: the launcher below must be starved of bun, not merely
  // running somewhere bun happens to be missing.
  expect(Bun.which("bun", { PATH: noBunPath })).toBeNull();
  expect(Bun.which("node", { PATH: noBunPath })).not.toBeNull();

  const result = runLauncher(["--echo-args", "hello"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("--echo-args,hello");
});

windowsNativeLauncherTest(
  "runs the staged Windows PE through the Node launcher with Bun absent from PATH",
  () => {
    const fixture = createNativeWindowsLauncherFixture(WINDOWS_LAUNCHER_BINARY as string);
    try {
      expect(Bun.which("bun", { PATH: noBunPath })).toBeNull();
      expect(Bun.which("node", { PATH: noBunPath })).not.toBeNull();

      const version = Bun.spawnSync({
        cmd: ["node", fixture.launcher, "--version"],
        env: { ...process.env, PATH: noBunPath },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(version.exitCode).toBe(0);
      expect(version.stdout.toString()).toMatch(/^kunai\s+v?\d/m);

      const help = Bun.spawnSync({
        cmd: ["node", fixture.launcher, "--help"],
        env: { ...process.env, PATH: noBunPath },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(help.exitCode).toBe(0);
      expect(help.stdout.toString().trim()).not.toBe("");
    } finally {
      removeTempDir(fixture.packageRoot);
    }
  },
);

execTest("passes the child's exit code through unchanged", () => {
  expect(runLauncher(["--exit-code", "0"]).exitCode).toBe(0);
  expect(runLauncher(["--exit-code", "42"]).exitCode).toBe(42);
});

execTest("passes npm ownership and its absolute package root to the compiled child", () => {
  const packageRoot = join(workDir, "npm", "node_modules", "@kitsunekode", "kunai");
  const fixtureLauncher = createLauncherFixture(packageRoot);

  expect(readManagedContext(fixtureLauncher)).toEqual({
    manager: "npm",
    packageRoot,
    unrelated: "preserved",
  });
});

execTest("passes Bun ownership for launchers under the Bun global package root", () => {
  const packageRoot = join(
    workDir,
    ".bun",
    "install",
    "global",
    "node_modules",
    "@kitsunekode",
    "kunai",
  );
  const fixtureLauncher = createLauncherFixture(packageRoot);

  expect(readManagedContext(fixtureLauncher)).toEqual({
    manager: "bun",
    packageRoot,
    unrelated: "preserved",
  });
});

execTest("preserves unrelated environment values across the launcher boundary", () => {
  const packageRoot = join(workDir, "preserve-env", "@kitsunekode", "kunai");
  const fixtureLauncher = createLauncherFixture(packageRoot);

  expect(readManagedContext(fixtureLauncher, "keep-me").unrelated).toBe("keep-me");
});

nodeTest("reports an actionable error when the platform binary is missing", () => {
  const empty = mkdtempSync(join(tmpdir(), "kunai-launcher-empty-"));
  mkdirSync(join(empty, "dist"), { recursive: true });
  const lonely = join(empty, "dist", "kunai.mjs");
  writeFileSync(lonely, readFileSync(LAUNCHER_SOURCE, "utf8"));

  const result = Bun.spawnSync({
    cmd: ["node", lonely],
    env: { ...process.env, PATH: noBunPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = result.stderr.toString();

  expect(result.exitCode).toBe(1);
  expect(stderr).toContain("@kitsunekode/kunai-");
  // Must name a way out, not just fail.
  expect(stderr).toMatch(/install -g|add -g/);
  expect(stderr).toContain("install.sh");

  removeTempDir(empty);
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
      env: { ...process.env, PATH: noBunPath },
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
