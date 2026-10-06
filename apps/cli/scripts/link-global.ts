#!/usr/bin/env bun
// `bun run link:global` — install `kunai` from this checkout.
//
// `bun link` alone links `dist/kunai.mjs` — the npm launcher — which does not
// exist until a build copies it, and which then resolves a published optional
// dependency over anything in the tree: a source install that silently runs
// registry bytes. This script guarantees both halves exist first: the launcher
// (a verbatim copy of scripts/npm-launcher.mjs, same as build.ts does) and the
// host binary in dist/bin/, which the launcher now prefers over packages.
//
// The launcher runs under Node (`#!/usr/bin/env node`) even when linked by
// bun, so `node` remains a prerequisite for the source path.

import { existsSync } from "node:fs";
import { chmod, copyFile } from "node:fs/promises";
import { join } from "node:path";

import { isMuslEnvironmentSync } from "../src/services/update/native-installer/musl";
import { resolveHostReleaseBinaryTarget } from "../src/services/update/platform-assets";

const ROOT = join(import.meta.dirname, "..");
const LAUNCHER = join(ROOT, "dist/kunai.mjs");
const LAUNCHER_SOURCE = join(ROOT, "scripts/npm-launcher.mjs");

async function ensureLauncher(): Promise<void> {
  if (existsSync(LAUNCHER)) return;
  await copyFile(LAUNCHER_SOURCE, LAUNCHER);
  await chmod(LAUNCHER, 0o755);
  console.log("[link:global] built dist/kunai.mjs launcher");
}

async function ensureHostBinary(): Promise<void> {
  const target = resolveHostReleaseBinaryTarget({
    libc: isMuslEnvironmentSync() ? "musl" : "gnu",
  });
  const binaryPath = join(ROOT, "dist/bin", target.out);
  if (existsSync(binaryPath)) return;
  console.log(`[link:global] dist/bin/${target.out} missing — building the host binary first`);
  const build = Bun.spawn(["bun", "run", "build:binary:host"], {
    cwd: ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await build.exited;
  if (code !== 0 || !existsSync(binaryPath)) {
    console.error(
      `[link:global] host binary build did not produce dist/bin/${target.out} — ` +
        `without it the launcher falls back to a published package, which is not this checkout.`,
    );
    process.exit(1);
  }
}

await ensureLauncher();
await ensureHostBinary();

const link = Bun.spawn(["bun", "link"], {
  cwd: ROOT,
  stdio: ["inherit", "inherit", "inherit"],
});
const code = await link.exited;
if (code !== 0) process.exit(code ?? 1);
console.log(`[link:global] kunai now resolves to this checkout's dist/bin build`);
