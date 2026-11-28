import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { checkDesktopProfile, DesktopProfileError } from "@kunai/storage";

import {
  inspectInstallManifest,
  readInstallManifest,
  sameInstallManifestPublication,
} from "./install-manifest";
import {
  detectInstallMethod,
  type DetectInstallMethodInput,
  type InstallMethodKind,
} from "./install-method";
import {
  getInstallLayoutPaths,
  sameInstallLauncherPath,
  uninstallStorageRoots,
  type InstallLayoutPaths,
} from "./native-installer/install-layout";
import { nativeUninstall } from "./native-installer/native-uninstall";
import { tryAcquireLifecycleLock } from "./native-installer/version-lock";

const PKG = "@kitsunekode/kunai";
const PRESERVED_USER_DATA =
  "Kept your config, history, cache, and downloaded videos. Re-run with --purge to delete them.";

export async function runUninstallCommand(purge: boolean): Promise<number> {
  if (purge && !(await confirmUninstallPurge())) {
    console.error("Uninstall cancelled.");
    return 0;
  }
  return runUninstall({ purge });
}

async function confirmUninstallPurge(): Promise<boolean> {
  const { dataDir } = getInstallLayoutPaths();
  const downloads = join(dataDir, "downloads");
  console.error(
    `This deletes your Kunai config, data, cache, and downloaded videos in ${downloads}.`,
  );
  if (!process.stdin.isTTY || !process.stderr.isTTY) return true;

  const { createInterface } = await import("node:readline");
  const input = createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write("Permanently delete them? [y/N] ");
  try {
    for await (const answer of input) {
      return /^y(es)?$/i.test(answer.trim());
    }
    return false;
  } finally {
    input.close();
  }
}

export type UninstallPlan =
  | { kind: "exec"; command: string[] }
  | { kind: "native"; launcherPath: string; versionsDir: string }
  | { kind: "remove-file"; path: string }
  | { kind: "manual"; message: string };

/** Pure routing: how to remove Kunai for a given install channel. */
export function planUninstall(input: {
  channel: InstallMethodKind;
  binPath: string;
  layout?: "flat" | "versioned";
}): UninstallPlan {
  switch (input.channel) {
    case "npm-global":
      return { kind: "exec", command: ["npm", "uninstall", "-g", PKG] };
    case "bun-global":
      return { kind: "exec", command: ["bun", "uninstall", "-g", PKG] };
    case "homebrew":
      return {
        kind: "manual",
        message: "Homebrew install detected. Remove it with `brew uninstall kunai`.",
      };
    case "scoop":
      return {
        kind: "manual",
        message: "Scoop install detected. Remove it with `scoop uninstall kunai`.",
      };
    case "system-package":
      return {
        kind: "manual",
        message:
          "Installed by your system package manager. Remove it with your package manager (Arch: `sudo pacman -R kunai-bin`).",
      };
    case "binary":
      if (input.layout === "versioned") {
        const layout = getInstallLayoutPaths({ launcherPath: input.binPath });
        return {
          kind: "native",
          launcherPath: layout.launcherPath,
          versionsDir: layout.versionsDir,
        };
      }
      return { kind: "remove-file", path: input.binPath };
    case "source":
      return {
        kind: "manual",
        message:
          "Source checkout: run `bun run unlink:global`, then delete the checkout directory.",
      };
    default:
      return { kind: "manual", message: "Unknown install method; remove kunai manually." };
  }
}

export type RunUninstallOptions = {
  readonly purge: boolean;
  readonly force?: boolean;
  readonly layout?: InstallLayoutPaths;
  readonly platform?: NodeJS.Platform;
  readonly preservePaths?: readonly string[];
  /** Test seam for package-manager delegation. */
  readonly execImpl?: (command: readonly string[]) => Promise<number>;
  /** Test seam for deterministic purge interleavings. */
  readonly rmImpl?: typeof rm;
  /** Test seam for compiled children carrying launcher ownership context. */
  readonly detectInstallMethodInput?: DetectInstallMethodInput;
};

/**
 * Channel-aware uninstall. Reads the manifest (falling back to install-method
 * detection), undoes the matching channel, and — only with `purge` — removes
 * user config/data/cache.
 * Returns a process exit code.
 */
export async function runUninstall(opts: RunUninstallOptions): Promise<number> {
  const layout = opts.layout ?? getInstallLayoutPaths();
  const rmImpl = opts.rmImpl ?? rm;

  // A profile layout must be owned before any manifest is read or lock is
  // acquired — the marker distinguishes Kunai's profile root from an
  // unrelated directory the env happens to name.
  if (layout.profileDir !== undefined) {
    try {
      checkDesktopProfile("require", layout.profileDir);
    } catch (error) {
      if (!(error instanceof DesktopProfileError)) throw error;
      console.error(error.message);
      return 2;
    }
  }

  const manifest = await readInstallManifest(layout.configDir);
  const channel: InstallMethodKind =
    manifest?.method ??
    (layout.profileDir !== undefined
      ? "source"
      : detectInstallMethod({
          fileExists: existsSync,
          ...opts.detectInstallMethodInput,
        }).kind);

  let plan: UninstallPlan;
  if (layout.profileDir !== undefined) {
    if (manifest === null) {
      plan = {
        kind: "manual",
        message: "No native Kunai install is recorded in this profile.",
      };
    } else if (manifest.method !== "binary" || !manifest.versionedPath) {
      // A non-binary or flat manifest under a profile records an experimental
      // layout uninstall cannot undo: delegating would run an account-wide
      // remover and trust an arbitrary manifest-specified launcher.
      plan = {
        kind: "manual",
        message:
          "This profile records an install layout `kunai uninstall` cannot remove. Reinstall into the profile with `kunai install` or the installer script, or remove it manually.",
      };
    } else {
      // The configured launcher wins: install.json's launcherPath is data, not
      // authority, inside an owned profile.
      if (!sameInstallLauncherPath(manifest.launcherPath, layout.launcherPath)) {
        console.error(
          `Refusing uninstall: install.json launcher ${manifest.launcherPath} disagrees with the profile's configured launcher ${layout.launcherPath}.`,
        );
        return 1;
      }
      plan = planUninstall({
        channel,
        binPath: layout.launcherPath,
        layout: "versioned",
      });
    }
  } else {
    plan = planUninstall({
      channel,
      binPath: manifest?.launcherPath ?? layout.launcherPath,
      layout: manifest?.versionedPath ? "versioned" : undefined,
    });
  }

  if (plan.kind === "manual") {
    if (!opts.purge) {
      console.log(plan.message);
      console.log(PRESERVED_USER_DATA);
      return 0;
    }
    const purged = await withPurgeSafeUninstallOwnership(layout, opts.force, async () => {
      const current = await inspectInstallManifest(layout.configDir);
      if (
        current.status === "invalid" ||
        (current.status === "loaded" &&
          (!manifest || !sameInstallManifestPublication(current.manifest, manifest)))
      ) {
        return false;
      }
      console.log(plan.message);
      if (!(await purgeUserRoots(layout, opts.preservePaths, rmImpl))) return false;
      return true;
    });
    if (!purged) {
      console.error(
        "Uninstall did not complete: ownership changed, a publication lock is active, or purge failed.",
      );
      return 1;
    }
    return 0;
  } else if (plan.kind === "exec") {
    const execImpl =
      opts.execImpl ??
      ((command: readonly string[]) =>
        Bun.spawn([...command], { stdout: "inherit", stderr: "inherit" }).exited);
    const removed = await withPurgeSafeUninstallOwnership(layout, opts.force, async () => {
      const current = await inspectInstallManifest(layout.configDir);
      if (
        current.status === "invalid" ||
        (current.status === "loaded" &&
          (!manifest || !sameInstallManifestPublication(current.manifest, manifest)))
      ) {
        return { status: "changed" as const };
      }
      const code = await execImpl(plan.command);
      if (code !== 0) return { status: "failed" as const, code };
      await rmImpl(join(layout.configDir, "install.json"), { force: true });
      if (opts.purge) {
        if (!(await purgeUserRoots(layout, opts.preservePaths, rmImpl))) {
          return { status: "purge-failed" as const };
        }
      }
      return { status: "removed" as const };
    });
    if (removed === null || removed.status === "changed") {
      console.error("Uninstall blocked: install manifest changed or publication lock is active.");
      return 1;
    }
    if (removed.status === "failed") {
      console.error(`Package manager uninstall exited with code ${removed.code}.`);
      return removed.code;
    }
    if (removed.status === "purge-failed") return 1;
    if (!opts.purge) {
      console.log(PRESERVED_USER_DATA);
    }
    return 0;
  } else if (plan.kind === "native") {
    const nativeLayout =
      opts.layout ??
      getInstallLayoutPaths({
        launcherPath: plan.launcherPath,
        configDir: layout.configDir,
        dataDir: layout.dataDir,
        cacheDir: layout.cacheDir,
      });
    const result = await nativeUninstall({
      layout: nativeLayout,
      purge: opts.purge,
      force: opts.force,
      platform: opts.platform,
      preservePaths: opts.preservePaths,
    });

    for (const path of result.removed) {
      console.log(`Removed ${path}`);
    }
    for (const entry of result.failed) {
      console.error(`Failed to remove ${entry.path}: ${entry.error}`);
    }

    if (result.status === "blocked") {
      console.error("Uninstall blocked: active lock/transaction or unmanaged launcher.");
      return 1;
    }
    if (result.status === "partial") {
      console.error("Uninstall partially completed; install manifest retained.");
      return 1;
    }
    if (!opts.purge) {
      console.log(PRESERVED_USER_DATA);
    }
    return 0;
  } else {
    const removed = await withPurgeSafeUninstallOwnership(layout, opts.force, async () => {
      const current = await inspectInstallManifest(layout.configDir);
      if (
        current.status === "invalid" ||
        (current.status === "loaded" &&
          (!manifest || !sameInstallManifestPublication(current.manifest, manifest)))
      ) {
        return false;
      }
      await rmImpl(plan.path, { force: true });
      console.log(`Removed ${plan.path}`);
      await rmImpl(join(layout.configDir, "install.json"), { force: true }).catch(() => {});
      if (opts.purge) {
        if (!(await purgeUserRoots(layout, opts.preservePaths, rmImpl))) return false;
      }
      return true;
    });
    if (!removed) {
      console.error(
        "Uninstall did not complete: ownership changed, a publication lock is active, or purge failed.",
      );
      return 1;
    }
  }

  if (!opts.purge) {
    console.log(PRESERVED_USER_DATA);
  }
  return 0;
}

/**
 * Hold the shared lifecycle -> activation composite across command execution,
 * manifest removal, and every purge root. The lifecycle primitive owns both
 * locks; acquiring activation again here would self-contend until timeout.
 */
async function withPurgeSafeUninstallOwnership<T>(
  layout: InstallLayoutPaths,
  force: boolean | undefined,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lifecycle = await tryAcquireLifecycleLock(layout, {
    force,
    execPath: process.execPath,
  });
  if (!lifecycle.acquired) return null;
  try {
    return await fn();
  } finally {
    await lifecycle.release();
  }
}

async function purgeUserRoots(
  layout: Pick<InstallLayoutPaths, "profileDir" | "configDir" | "dataDir" | "cacheDir">,
  preservePaths: readonly string[] | undefined,
  rmImpl: typeof rm = rm,
): Promise<boolean> {
  const preserve = new Set(preservePaths ?? []);
  let success = true;
  for (const target of uninstallStorageRoots(layout)) {
    if (preserve.has(target)) {
      console.log(`Preserved ${target}`);
      continue;
    }
    try {
      await rmImpl(target, { recursive: true, force: true });
      console.log(`Removed ${target}`);
    } catch (error) {
      success = false;
      console.error(
        `Failed to remove ${target}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  return success;
}
