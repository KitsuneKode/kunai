#!/usr/bin/env bun
// Build a single release binary for the current machine only.
//
// Faster than `build:binaries` when you want to compile and smoke-test locally
// without cross-compiling all eight release targets.
//
// Usage:
//   bun run scripts/build-host-binary.ts
//   bun run scripts/build-host-binary.ts --smoke
//   bun run scripts/build-host-binary.ts --skip-typecheck --analyze
//   bun run scripts/build-host-binary.ts --list
//   bun run scripts/build-host-binary.ts --libc musl   # force musl on Linux
//
// From repo root:
//   bun run build:binary:host
//   bun run build:binary:host:test

import { existsSync } from "node:fs";
import { join } from "node:path";

import { isMuslEnvironmentSync } from "../src/services/update/native-installer/musl";
import {
  RELEASE_BINARY_TARGETS,
  resolveHostReleaseBinaryTarget,
  type PlatformLibc,
} from "../src/services/update/platform-assets";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "dist/bin");

function parseLibcOverride(argv: readonly string[]): PlatformLibc | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--libc") {
      const value = argv[i + 1];
      if (value === "gnu" || value === "musl") return value;
      throw new Error(`[host-binary] --libc must be gnu or musl, got "${value ?? ""}"`);
    }
  }
  return undefined;
}

function forwardBuildArgs(argv: readonly string[]): string[] {
  const skip = new Set(["--smoke", "--test", "--skip-typecheck", "--list", "--libc"]);
  const forwarded: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || skip.has(arg)) continue;
    if (arg === "--libc") {
      i += 1;
      continue;
    }
    forwarded.push(arg);
  }
  return forwarded;
}

async function run(command: string[], cwd: string): Promise<number> {
  const proc = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  return proc.exited;
}

async function smokeBinary(binaryPath: string): Promise<void> {
  if (!existsSync(binaryPath)) {
    throw new Error(`[host-binary] smoke failed: missing ${binaryPath}`);
  }

  const versionProc = Bun.spawn([binaryPath, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    versionProc.exited,
    new Response(versionProc.stdout).text(),
    new Response(versionProc.stderr).text(),
  ]);
  const combined = `${stdout}${stderr}`.trim();
  if (exitCode !== 0) {
    throw new Error(`[host-binary] ${binaryPath} --version exited ${exitCode}: ${combined}`);
  }
  if (!/^kunai\s+v?\d/.test(combined)) {
    throw new Error(
      `[host-binary] ${binaryPath} --version must print kunai semver, got: ${combined}`,
    );
  }

  const helpCode = await run([binaryPath, "--help"], ROOT);
  if (helpCode !== 0) {
    throw new Error(`[host-binary] ${binaryPath} --help exited ${helpCode}`);
  }

  console.log(`[host-binary] smoke ok: ${combined}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--list")) {
    const libcOverride = parseLibcOverride(argv);
    const hostLibc =
      libcOverride ?? (process.platform === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu");
    const host = resolveHostReleaseBinaryTarget({ libc: hostLibc });
    console.log("[host-binary] published targets:");
    for (const target of RELEASE_BINARY_TARGETS) {
      const marker = target.id === host.id ? "  ← this host" : "";
      console.log(`  ${target.id.padEnd(18)} ${target.out}${marker}`);
    }
    return;
  }

  const skipTypecheck = argv.includes("--skip-typecheck");
  const smoke = argv.includes("--smoke") || argv.includes("--test");
  const libcOverride = parseLibcOverride(argv);
  const hostLibc =
    libcOverride ?? (process.platform === "linux" && isMuslEnvironmentSync() ? "musl" : "gnu");
  const target = resolveHostReleaseBinaryTarget({ libc: hostLibc });

  console.log(
    `[host-binary] host ${process.platform}/${process.arch}` +
      (process.platform === "linux" ? ` (${hostLibc})` : "") +
      ` → ${target.id} (${target.triple})`,
  );

  if (!skipTypecheck) {
    console.log("[host-binary] typecheck …");
    const typecheckCode = await run(["bun", "tsc", "--noEmit"], ROOT);
    if (typecheckCode !== 0) process.exit(typecheckCode);
  }

  const buildArgs = [
    "run",
    join(ROOT, "scripts/build-binaries.ts"),
    "--only",
    target.id,
    "--jobs",
    "1",
    ...forwardBuildArgs(argv),
  ];
  const buildCode = await run(["bun", ...buildArgs], ROOT);
  if (buildCode !== 0) process.exit(buildCode);

  const outfile = join(OUT, target.out);
  console.log(`[host-binary] ready: ${outfile}`);
  console.log(`[host-binary] run: ${outfile} --help`);

  if (smoke) {
    await smokeBinary(outfile);
  }
}

await main();
