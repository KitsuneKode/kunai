#!/usr/bin/env node
// Kunai npm entry point.
//
// This file is deliberately plain Node ESM: no Bun, no `bun:` imports, no
// TypeScript, and it is published as-is rather than bundled. The previous `bin`
// pointed at the whole Bun-compiled app, so `npm install -g @kitsunekode/kunai`
// produced a command that could not start without Bun — the one thing the npm
// install path exists to avoid.
//
// It resolves the prebuilt binary for the host from an optional dependency,
// spawns it, forwards signals, and mirrors the child's exit status.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Linux ships two incompatible C libraries and `process.platform` cannot tell
 * them apart. Node reports the runtime glibc version only when it is actually
 * linked against glibc, so its absence on Linux means musl (Alpine, and most
 * slim container images).
 */
function detectLibc() {
  if (process.platform !== "linux") return "gnu";
  try {
    const report = process.report?.getReport();
    const header = typeof report === "string" ? JSON.parse(report).header : report?.header;
    return header?.glibcVersionRuntime ? "gnu" : "musl";
  } catch {
    // Unknown: assume glibc, the common case. A wrong guess still produces the
    // actionable "reinstall / use the native installer" error below rather than
    // a crash, because the package simply will not be present.
    return "gnu";
  }
}

/** Target id matching RELEASE_BINARY_TARGETS in src/services/update/platform-assets.ts. */
function resolveTargetId() {
  const { platform, arch } = process;
  const libc = detectLibc();

  if (platform === "linux") {
    if (arch === "x64") return libc === "musl" ? "linux-x64-musl" : "linux-x64";
    if (arch === "arm64") return libc === "musl" ? "linux-arm64-musl" : "linux-arm64";
    return null;
  }
  if (platform === "darwin") {
    if (arch === "x64") return "darwin-x64";
    if (arch === "arm64") return "darwin-arm64";
    return null;
  }
  if (platform === "win32") {
    if (arch === "x64") return "windows-x64";
    if (arch === "arm64") return "windows-arm64";
    return null;
  }
  return null;
}

function binaryFileName() {
  return process.platform === "win32" ? "kunai.exe" : "kunai";
}

/**
 * Package-manager hint for the reinstall message. Kept to the signals that are
 * actually reliable at runtime: the user agent npm/bun/pnpm set while running a
 * lifecycle script, then the install path shape.
 */
function detectPackageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (/\bbun\//.test(userAgent)) return "bun";
  if (/\bpnpm\//.test(userAgent)) return "pnpm";
  if (/\bnpm\//.test(userAgent)) return "npm";

  const execPath = process.env.npm_execpath ?? "";
  if (execPath.includes("bun")) return "bun";
  if (execPath.includes("pnpm")) return "pnpm";

  const here = __dirname.replaceAll("\\", "/");
  if (here.includes("/.bun/install/global")) return "bun";
  if (here.includes("/pnpm/") || here.includes("/.pnpm/")) return "pnpm";
  return "npm";
}

function reinstallCommand() {
  switch (detectPackageManager()) {
    case "bun":
      return "bun install -g @kitsunekode/kunai@latest";
    case "pnpm":
      return "pnpm add -g @kitsunekode/kunai@latest";
    default:
      return "npm install -g @kitsunekode/kunai@latest";
  }
}

function findBinary(targetId) {
  const packageName = `@kitsunekode/kunai-${targetId}`;

  // Preferred: the optional dependency npm installed for this platform.
  try {
    const manifest = require.resolve(`${packageName}/package.json`);
    const candidate = path.join(path.dirname(manifest), "bin", binaryFileName());
    if (existsSync(candidate)) return candidate;
  } catch {
    // Not installed — fall through to the vendor layout.
  }

  // Fallback: a vendored binary beside the package. Keeps source checkouts, CI,
  // and offline/manual installs working without publishing anything.
  const vendored = path.join(__dirname, "..", "vendor", targetId, "bin", binaryFileName());
  if (existsSync(vendored)) return vendored;

  return null;
}

const targetId = resolveTargetId();
if (!targetId) {
  console.error(
    `kunai: unsupported platform ${process.platform} (${process.arch}).\n` +
      `Supported: linux/macOS/Windows on x64 or arm64.\n` +
      `Build from source instead: https://github.com/KitsuneKode/kunai`,
  );
  process.exit(1);
}

const binaryPath = findBinary(targetId);
if (!binaryPath) {
  console.error(
    `kunai: missing the prebuilt binary for ${targetId} ` +
      `(optional dependency @kitsunekode/kunai-${targetId}).\n\n` +
      `This usually means the install skipped optional dependencies.\n` +
      `Reinstall with:  ${reinstallCommand()}\n\n` +
      `Or use the native installer, which does not depend on a package manager:\n` +
      `  curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash`,
  );
  process.exit(1);
}

// Spawn asynchronously, never spawnSync: the parent must stay responsive to
// signals so it can forward them to the child. mpv runs under this process, so
// a swallowed Ctrl-C would strand a player.
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, KUNAI_MANAGED_PACKAGE_ROOT: path.join(__dirname, "..") },
});

child.on("error", (error) => {
  console.error(`kunai: failed to start ${binaryPath}\n${error?.message ?? error}`);
  process.exit(1);
});

const forwardSignal = (signal) => {
  if (child.killed) return;
  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the check and the kill; nothing to do.
  }
};

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of FORWARDED_SIGNALS) {
  process.on(signal, () => forwardSignal(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    // Die the same way the child did so shells observe the conventional 128+n
    // status. The listener must go first: while a handler is registered Node
    // delivers the re-raised signal to it instead of terminating, so the process
    // would survive and exit 0 — silently losing the exit status.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
