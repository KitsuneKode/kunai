import { rm } from "node:fs/promises";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import { readInstallManifest } from "./install-manifest";
import type { InstallMethodKind } from "./install-method";
import { getInstallLayoutPaths, removeLauncherIfVersioned } from "./native-installer";

const PKG = "@kitsunekode/kunai";
const MANIFEST_FILE = "install.json";

export type UninstallPlan =
  | { kind: "exec"; command: string[] }
  | { kind: "remove-binary"; launcherPath: string; versionsDir: string }
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
          kind: "remove-binary",
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

/**
 * Channel-aware uninstall. Reads the manifest (falls back to "unknown"), undoes
 * the matching channel, and — only with `purge` — removes user config/data/cache.
 * Returns a process exit code.
 */
export async function runUninstall(opts: { purge: boolean }): Promise<number> {
  const manifest = await readInstallManifest();
  const channel: InstallMethodKind = manifest?.method ?? "unknown";
  const plan = planUninstall({
    channel,
    binPath: manifest?.launcherPath ?? process.execPath,
    layout: manifest?.versionedPath ? "versioned" : undefined,
  });

  if (plan.kind === "manual") {
    console.log(plan.message);
  } else if (plan.kind === "exec") {
    const code = await Bun.spawn(plan.command, { stdout: "inherit", stderr: "inherit" }).exited;
    if (code !== 0) {
      console.error(`Package manager uninstall exited with code ${code}.`);
      return code;
    }
  } else if (plan.kind === "remove-binary") {
    const removed = await removeLauncherIfVersioned({
      launcherPath: plan.launcherPath,
      versionsDir: plan.versionsDir,
    });
    if (removed) {
      console.log(`Removed launcher ${plan.launcherPath}`);
    }
    await rm(plan.versionsDir, { recursive: true, force: true }).catch(() => {});
    console.log(`Removed versioned binaries under ${plan.versionsDir}`);
  } else {
    await rm(plan.path, { force: true });
    console.log(`Removed ${plan.path}`);
  }

  await rm(join(getKunaiPaths().configDir, MANIFEST_FILE), { force: true }).catch(() => {});

  if (opts.purge) {
    const paths = getKunaiPaths();
    for (const target of [paths.configDir, paths.dataDir, paths.cacheDir]) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
    }
    console.log("Removed Kunai config, data, and cache.");
  } else {
    console.log("Left your config/history/cache in place. Re-run with --purge to remove them.");
  }
  return 0;
}
