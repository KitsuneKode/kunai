import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { readInstallManifest } from "./install-manifest";
import {
  detectInstallMethod,
  type DetectInstallMethodInput,
  type InstallMethodKind,
} from "./install-method";
import { getInstallLayoutPaths, type InstallLayoutPaths } from "./native-installer/install-layout";
import { nativeUninstall } from "./native-installer/native-uninstall";

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
    console.log(plan.message);
  } else if (plan.kind === "exec") {
    const execImpl =
      opts.execImpl ??
      ((command: readonly string[]) =>
        Bun.spawn([...command], { stdout: "inherit", stderr: "inherit" }).exited);
    const code = await execImpl(plan.command);
    if (code !== 0) {
      console.error(`Package manager uninstall exited with code ${code}.`);
      return code;
    }
    await rm(join(layout.configDir, "install.json"), { force: true });
    if (opts.purge) {
      await purgeUserRoots(layout, opts.preservePaths);
    } else {
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
    await rm(plan.path, { force: true });
    console.log(`Removed ${plan.path}`);
    await rm(join(layout.configDir, "install.json"), { force: true }).catch(() => {});
  }

  if (opts.purge) {
    await purgeUserRoots(layout, opts.preservePaths);
  } else {
    console.log("Left your config/history/cache in place. Re-run with --purge to remove them.");
  }
  return 0;
}

async function purgeUserRoots(
  layout: Pick<InstallLayoutPaths, "configDir" | "dataDir" | "cacheDir">,
  preservePaths: readonly string[] | undefined,
): Promise<void> {
  const preserve = new Set(preservePaths ?? []);
  for (const target of [layout.configDir, layout.dataDir, layout.cacheDir]) {
    if (preserve.has(target)) {
      console.log(`Preserved ${target}`);
      continue;
    }
    await rm(target, { recursive: true, force: true }).catch(() => {});
    console.log(`Removed ${target}`);
  }
}
