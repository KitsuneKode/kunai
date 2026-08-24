import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

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
import { tryAcquireActivationLock } from "./native-installer/activation-lock";
import { getInstallLayoutPaths, type InstallLayoutPaths } from "./native-installer/install-layout";
import { nativeUninstall } from "./native-installer/native-uninstall";
import { tryAcquireLifecycleLock } from "./native-installer/version-lock";

const PKG = "@kitsunekode/kunai";

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
  const manifest = await readInstallManifest(layout.configDir);
  const channel: InstallMethodKind =
    manifest?.method ??
    detectInstallMethod({
      fileExists: existsSync,
      ...opts.detectInstallMethodInput,
    }).kind;
  const plan = planUninstall({
    channel,
    binPath: manifest?.launcherPath ?? layout.launcherPath,
    layout: manifest?.versionedPath ? "versioned" : undefined,
  });

  if (plan.kind === "manual") {
    if (!opts.purge) {
      console.log(plan.message);
      console.log("Left your config/history/cache in place. Re-run with --purge to remove them.");
      return 0;
    }
    const purged = await withPurgeSafeUninstallOwnership(
      layout,
      manifest?.activeVersion ?? "0.0.0",
      opts.force,
      async () => {
        const current = await inspectInstallManifest(layout.configDir);
        if (
          current.status === "invalid" ||
          (current.status === "loaded" &&
            (!manifest || !sameInstallManifestPublication(current.manifest, manifest)))
        ) {
          return false;
        }
        console.log(plan.message);
        await purgeUserRoots(layout, opts.preservePaths, rmImpl);
        return true;
      },
    );
    if (!purged) {
      console.error("Uninstall blocked: install manifest changed or publication lock is active.");
      return 1;
    }
    return 0;
  } else if (plan.kind === "exec") {
    const execImpl =
      opts.execImpl ??
      ((command: readonly string[]) =>
        Bun.spawn([...command], { stdout: "inherit", stderr: "inherit" }).exited);
    const removed = await withPurgeSafeUninstallOwnership(
      layout,
      manifest?.activeVersion ?? "0.0.0",
      opts.force,
      async () => {
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
          await purgeUserRoots(layout, opts.preservePaths, rmImpl);
        }
        return { status: "removed" as const };
      },
    );
    if (removed === null || removed.status === "changed") {
      console.error("Uninstall blocked: install manifest changed or publication lock is active.");
      return 1;
    }
    if (removed.status === "failed") {
      console.error(`Package manager uninstall exited with code ${removed.code}.`);
      return removed.code;
    }
    if (!opts.purge) {
      console.log("Left your config/history/cache in place. Re-run with --purge to remove them.");
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
      console.log("Left your config/history/cache in place. Re-run with --purge to remove them.");
    }
    return 0;
  } else {
    const removed = await withPurgeSafeUninstallOwnership(
      layout,
      manifest?.activeVersion ?? "0.0.0",
      opts.force,
      async () => {
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
          await purgeUserRoots(layout, opts.preservePaths, rmImpl);
        }
        return true;
      },
    );
    if (!removed) {
      console.error("Uninstall blocked: install manifest changed or publication lock is active.");
      return 1;
    }
  }

  if (!opts.purge) {
    console.log("Left your config/history/cache in place. Re-run with --purge to remove them.");
  }
  return 0;
}

/**
 * Current-base adapter for the purge-safe lifecycle -> activation composite.
 * Keeping the acquisition boundary here lets the base lifecycle implementation
 * own this contract after the updater branch is rebased.
 */
async function withPurgeSafeUninstallOwnership<T>(
  layout: InstallLayoutPaths,
  version: string,
  force: boolean | undefined,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lifecycle = await tryAcquireLifecycleLock(layout, {
    force,
    execPath: process.execPath,
  });
  if (!lifecycle.acquired) return null;
  try {
    const activation = await tryAcquireActivationLock(layout, version);
    if (!activation.acquired) return null;
    try {
      return await fn();
    } finally {
      await activation.release();
    }
  } finally {
    await lifecycle.release();
  }
}

async function purgeUserRoots(
  layout: Pick<InstallLayoutPaths, "configDir" | "dataDir" | "cacheDir">,
  preservePaths: readonly string[] | undefined,
  rmImpl: typeof rm = rm,
): Promise<void> {
  const preserve = new Set(preservePaths ?? []);
  for (const target of [layout.configDir, layout.cacheDir, layout.dataDir]) {
    if (preserve.has(target)) {
      console.log(`Preserved ${target}`);
      continue;
    }
    await rmImpl(target, { recursive: true, force: true }).catch(() => {});
    console.log(`Removed ${target}`);
  }
}
