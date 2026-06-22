import { existsSync } from "node:fs";
import { readlink, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const PKG = "@kitsunekode/kunai";

export type CleanupNpmResult = {
  readonly removed: number;
  readonly errors: string[];
};

function isNpmShimPath(resolved: string): boolean {
  return resolved.endsWith(".js") || resolved.includes("node_modules");
}

/**
 * Remove global npm install artifacts after a successful native binary install.
 * Best-effort — errors are collected, not thrown.
 */
export async function cleanupNpmInstallations(): Promise<CleanupNpmResult> {
  const errors: string[] = [];
  let removed = 0;

  if (Bun.which("npm")) {
    const proc = Bun.spawn(["npm", "uninstall", "-g", PKG], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code === 0) removed += 1;
    else {
      const stderr = await new Response(proc.stderr).text();
      if (!stderr.includes("ENOENT") && !stderr.toLowerCase().includes("not found")) {
        errors.push(`npm uninstall failed: ${stderr.trim() || `exit ${code}`}`);
      }
    }
  }

  const npmPrefix = await resolveNpmGlobalBin();
  if (npmPrefix) {
    const kunaiPath = join(npmPrefix, process.platform === "win32" ? "kunai.cmd" : "kunai");
    if (existsSync(kunaiPath)) {
      try {
        if (process.platform !== "win32") {
          const target = await readlink(kunaiPath).catch(() => kunaiPath);
          if (isNpmShimPath(target)) {
            await rm(kunaiPath, { force: true });
            removed += 1;
          }
        } else {
          await rm(kunaiPath, { force: true });
          removed += 1;
        }
      } catch (err) {
        errors.push(`Failed to remove npm shim: ${(err as Error).message}`);
      }
    }
  }

  return { removed, errors };
}

async function resolveNpmGlobalBin(): Promise<string | null> {
  if (!Bun.which("npm")) return null;
  const proc = Bun.spawn(["npm", "config", "get", "prefix"], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  const prefix = stdout.trim();
  if (!prefix || prefix === "undefined") return null;
  return join(prefix, process.platform === "win32" ? "" : "bin").replace(/[/\\]$/, "") || prefix;
}

/** Safe unlink of native launcher when leaving versioned install (not npm shim). */
export async function removeInstalledSymlink(launcherPath: string): Promise<boolean> {
  if (!existsSync(launcherPath)) return false;
  if (process.platform === "win32") {
    await rm(launcherPath, { force: true });
    return true;
  }
  try {
    const target = await readlink(launcherPath);
    if (!isNpmShimPath(target)) {
      await rm(launcherPath, { force: true });
      return true;
    }
  } catch {
    await rm(launcherPath, { force: true });
    return true;
  }
  return false;
}
