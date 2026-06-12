import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { getKunaiPaths } from "@kunai/storage";

// Embedded so `bun build --compile` single-file binaries carry the Lua bridge.
// Resolves to a real path in dev/npm-bundle and a `/$bunfs/` path in a compiled
// binary; `Bun.file()` reads both, and `Bun.write()` (unlike Node `copyFile`)
// can copy from a `/$bunfs/` source. See docs/superpowers/plans/2026-06-13-*.
import bridgeLua from "../../../assets/mpv/kunai-bridge.lua" with { type: "file" };

const SCRIPT_OPTS_ID = "kunai-bridge";

/**
 * Packaged / dev / compiled-binary source for the bridge. The `with { type: "file" }`
 * import is correct in every runtime mode, so we no longer probe sibling dirs.
 */
export function bundledKunaiMpvBridgePath(): string {
  return bridgeLua;
}

/** Writable copy of the bridge: same layout as Kunai `config.json` (`getKunaiPaths().mpvBridgePath`). */
export function userKunaiMpvBridgePath(): string {
  return getKunaiPaths().mpvBridgePath;
}

/**
 * Materialize the bridge at a writable path mpv can load via `--script=`.
 * Uses `Bun.write` (not Node `copyFile`) so it works when `bundledPath` is a
 * `/$bunfs/` embedded path inside a compiled binary. `dest` is injectable for tests.
 */
export async function ensureUserKunaiMpvBridge(
  bundledPath: string,
  dest: string = userKunaiMpvBridgePath(),
): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  if (!existsSync(bundledPath)) return;
  if (!existsSync(dest)) {
    await Bun.write(dest, Bun.file(bundledPath));
    return;
  }
  // Refresh when the source is newer. stat on a `/$bunfs/` path can throw; treat
  // any failure as "leave the existing copy" (best-effort, matches prior behavior).
  const { statSync } = await import("node:fs");
  try {
    if (statSync(bundledPath).mtimeMs > statSync(dest).mtimeMs) {
      await Bun.write(dest, Bun.file(bundledPath));
    }
  } catch {
    // best-effort
  }
}

/**
 * Persistent autoplay wires the bridge to Bun through mpv IPC (Unix socket or Windows named pipe).
 * Custom `mpvKunaiScriptPath` wins when it exists on disk.
 */
export async function resolveKunaiMpvBridgeScriptPath(
  config: KitsuneConfig,
): Promise<string | null> {
  const custom = config.mpvKunaiScriptPath?.trim();
  if (custom && existsSync(custom)) return custom;

  const bundled = bundledKunaiMpvBridgePath();
  await ensureUserKunaiMpvBridge(bundled);

  const user = userKunaiMpvBridgePath();
  if (existsSync(user)) return user;
  if (existsSync(bundled)) return bundled;
  return null;
}

export function buildKunaiBridgeScriptOptsArg(
  opts: Record<string, string> | undefined,
): string | undefined {
  if (!opts) return undefined;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(opts)) {
    const key = k.trim();
    if (!key || v === "") continue;
    parts.push(`${SCRIPT_OPTS_ID}-${key}=${v}`);
  }
  if (parts.length === 0) return undefined;
  return parts.join(",");
}

/** Only temp generated keys scripts should be deleted on shutdown. */
export function isEphemeralKunaiLuaScript(path: string | null | undefined): boolean {
  if (!path) return false;
  const t = tmpdir();
  return path.startsWith(t) && path.includes("kunai-mpv-keys-");
}

/** Duration for skip chip + delayed auto-skip (ms), from config script-opts `prompt_seconds`. */
export function parseSkipPromptDurationMs(opts: Record<string, string> | undefined): number {
  const raw = opts?.prompt_seconds?.trim();
  const sec = raw ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(sec) || sec < 1) return 3000;
  return Math.round(sec * 1000);
}
