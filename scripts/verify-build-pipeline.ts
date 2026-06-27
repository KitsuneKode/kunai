#!/usr/bin/env bun
// Local verification gate for the npm + binary build pipeline.
//
// Usage:
//   bun run scripts/verify-build-pipeline.ts
//   bun run scripts/verify-build-pipeline.ts --pr
//   KUNAI_VERIFY_ALL_BINARIES=1 bun run scripts/verify-build-pipeline.ts --all-targets

import { spawnSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { join } from "node:path";

import {
  RELEASE_BINARY_TARGETS,
  resolveHostReleaseBinaryTarget,
} from "../apps/cli/src/services/update/platform-assets";

const REPO_ROOT = join(import.meta.dirname, "..");
const CLI_ROOT = join(REPO_ROOT, "apps/cli");
const DIST = join(CLI_ROOT, "dist");
const NPM_BUNDLE = join(DIST, "kunai.js");
const LINUX_GLIBC_BIN = join(DIST, "bin/kunai-linux-x64");

const argv = process.argv.slice(2);
const prMode = argv.includes("--pr");
const allTargets = argv.includes("--all-targets") || process.env.KUNAI_VERIFY_ALL_BINARIES === "1";

const MIN_DISK_BYTES = 1024 * 1024 * 1024;
const WARN_DISK_BYTES = 2 * MIN_DISK_BYTES;

function log(step: string): void {
  console.log(`[verify:build-pipeline] ${step}`);
}

function run(command: string, args: string[], options: { cwd?: string } = {}): void {
  log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command: string, args: string[], options: { cwd?: string } = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function assertExists(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`[verify:build-pipeline] missing ${label}: ${path}`);
  }
}

function freeBytesForPath(path: string): number {
  try {
    const stats = statfsSync(path);
    return stats.bfree * stats.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function assertDiskBudget(): void {
  const free = freeBytesForPath(DIST);
  if (!Number.isFinite(free)) return;
  if (free < MIN_DISK_BYTES) {
    throw new Error(
      `[verify:build-pipeline] need at least 1 GiB free on the dist partition (have ${Math.round(free / (1024 * 1024))} MiB).`,
    );
  }
  if (free < WARN_DISK_BYTES) {
    console.warn(
      `[verify:build-pipeline] warning: only ${Math.round(free / (1024 * 1024))} MiB free; all-targets build needs ~750 MiB.`,
    );
  }
}

function assertTurboCacheHit(): void {
  const output = capture("bunx", [
    "turbo",
    "run",
    "build",
    "build:binary:host",
    "--filter=@kitsunekode/kunai",
    "--summarize",
  ]);
  const hitCount = (output.match(/\bcache hit\b/gi) ?? []).length;
  if (hitCount < 2) {
    throw new Error(
      `[verify:build-pipeline] expected Turbo cache hits for build + build:binary:host, got ${hitCount}.`,
    );
  }
  log(`turbo cache hits: ${hitCount}`);
}

function hostBinaryPath(): string {
  const host = resolveHostReleaseBinaryTarget();
  return join(DIST, "bin", host.out);
}

async function main(): Promise<void> {
  if (
    allTargets &&
    process.env.KUNAI_VERIFY_ALL_BINARIES !== "1" &&
    !argv.includes("--all-targets")
  ) {
    console.error(
      "[verify:build-pipeline] set KUNAI_VERIFY_ALL_BINARIES=1 or pass --all-targets for the full 8-target build.",
    );
    process.exit(1);
  }

  log("step 1/… typecheck");
  run("bun", ["run", "typecheck"]);

  log("step 2/… build (npm bundle + host binary)");
  run("bun", ["run", "build"]);

  log("step 3/… pkg:check");
  run("bun", ["run", "pkg:check"]);

  assertExists(NPM_BUNDLE, "npm bundle");
  const hostBin = hostBinaryPath();
  if (existsSync(hostBin)) {
    log(`host binary present: ${hostBin}`);
  } else {
    console.warn(
      `[verify:build-pipeline] host binary not found at ${hostBin}; skipping host smoke.`,
    );
  }

  log("step 4/… turbo cache hit check");
  assertTurboCacheHit();

  if (existsSync(hostBin)) {
    log("step 5/… verify-host-binary.sh");
    run("bash", ["apps/cli/scripts/verify-host-binary.sh"]);
  }

  if (prMode || allTargets) {
    const jobs = process.env.KUNAI_VERIFY_FORCE_JOBS === "1" ? "2" : "2";
    if (allTargets) {
      assertDiskBudget();
      log(`step 6/… build:binaries (all ${RELEASE_BINARY_TARGETS.length} targets, jobs=${jobs})`);
      run("bunx", [
        "turbo",
        "run",
        "build:binaries",
        "--filter=@kitsunekode/kunai",
        "--",
        "--jobs",
        jobs,
      ]);
      log("step 7/… verify-release-binaries.sh (full)");
      run("bash", ["apps/cli/scripts/verify-release-binaries.sh"]);
    } else {
      log("step 6/… build:binaries (linux glibc + musl)");
      run("bunx", [
        "turbo",
        "run",
        "build:binaries",
        "--filter=@kitsunekode/kunai",
        "--",
        "--only",
        "linux-x64",
        "--only",
        "linux-x64-musl",
        "--jobs",
        "2",
      ]);
      log("step 7/… verify-release-binaries.sh --partial");
      run("bash", ["apps/cli/scripts/verify-release-binaries.sh", "--partial"]);
      if (existsSync(LINUX_GLIBC_BIN)) {
        const version = capture(LINUX_GLIBC_BIN, ["--version"]).trim();
        if (!/^kunai\s+v?\d/.test(version)) {
          throw new Error(`[verify:build-pipeline] unexpected --version output: ${version}`);
        }
        run(LINUX_GLIBC_BIN, ["--help"]);
      }
    }

    log("final pkg:check after binary build");
    run("bun", ["run", "pkg:check"]);
  }

  log("ok");
}

await main();
