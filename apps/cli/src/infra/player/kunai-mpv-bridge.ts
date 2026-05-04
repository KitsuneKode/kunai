import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { getKunaiPaths } from "@kunai/storage";

const BRIDGE_FILENAME = "kunai-bridge.lua";
const SCRIPT_OPTS_ID = "kunai-bridge";

/** Packaged / dev: bridge under `apps/cli/assets/mpv` (from `src/...` or `dist/kunai.js`). */
export function bundledKunaiMpvBridgePath(): string {
  const dir =
    typeof import.meta.dirname !== "undefined"
      ? import.meta.dirname
      : dirname(fileURLToPath(import.meta.url));
  // Packaged: `dist/kunai.js` ships `dist/assets/mpv` (npm `files`: dist only). Monorepo: sibling `cli/assets/mpv`. Dev: `src/infra/player` → cli root.
  const fromDistBundle = join(dir, "assets", "mpv", BRIDGE_FILENAME);
  if (existsSync(fromDistBundle)) return fromDistBundle;
  const fromCliRoot = join(dir, "..", "assets", "mpv", BRIDGE_FILENAME);
  if (existsSync(fromCliRoot)) return fromCliRoot;
  const fromSrcTree = join(dir, "..", "..", "..", "assets", "mpv", BRIDGE_FILENAME);
  if (existsSync(fromSrcTree)) return fromSrcTree;
  return fromDistBundle;
}

/** Writable copy of the bridge: same layout as Kunai `config.json` (`getKunaiPaths().mpvBridgePath`). */
export function userKunaiMpvBridgePath(): string {
  return getKunaiPaths().mpvBridgePath;
}

export async function ensureUserKunaiMpvBridge(bundledPath: string): Promise<void> {
  const dest = userKunaiMpvBridgePath();
  await mkdir(dirname(dest), { recursive: true });
  if (!existsSync(bundledPath)) return;
  if (!existsSync(dest)) {
    await copyFile(bundledPath, dest);
    return;
  }
  const { statSync } = await import("node:fs");
  try {
    if (statSync(bundledPath).mtimeMs > statSync(dest).mtimeMs) {
      await copyFile(bundledPath, dest);
    }
  } catch {
    // best-effort
  }
}

/**
 * Persistent autoplay wires the bridge to Bun through mpv IPC on a Unix domain socket.
 * `PersistentMpvSession` disables that socket path on Windows (`ipcPath === null`), so the
 * default bundled/user mirror path is not used there; an explicit `mpvKunaiScriptPath` still resolves.
 */
export async function resolveKunaiMpvBridgeScriptPath(
  config: KitsuneConfig,
): Promise<string | null> {
  const custom = config.mpvKunaiScriptPath?.trim();
  if (custom && existsSync(custom)) return custom;

  if (process.platform === "win32") return null;

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
