import { rm } from "node:fs/promises";

import { getKunaiPaths } from "@kunai/storage";

import { readInstallManifest } from "./install-manifest";
import type { InstallMethodKind } from "./install-method";

const PKG = "@kitsunekode/kunai";

export type UninstallPlan =
  | { kind: "exec"; command: string[] }
  | { kind: "remove-file"; path: string }
  | { kind: "manual"; message: string };

/** Pure routing: how to remove Kunai for a given install channel. */
export function planUninstall(input: {
  channel: InstallMethodKind;
  binPath: string;
}): UninstallPlan {
  switch (input.channel) {
    case "npm-global":
      return { kind: "exec", command: ["npm", "uninstall", "-g", PKG] };
    case "bun-global":
      return { kind: "exec", command: ["bun", "uninstall", "-g", PKG] };
    case "binary":
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
  const channel: InstallMethodKind = manifest?.channel ?? "unknown";
  const plan = planUninstall({ channel, binPath: manifest?.binPath ?? process.execPath });

  if (plan.kind === "manual") {
    console.log(plan.message);
  } else if (plan.kind === "exec") {
    await Bun.spawn(plan.command, { stdout: "inherit", stderr: "inherit" }).exited;
  } else {
    await rm(plan.path, { force: true });
    console.log(`Removed ${plan.path}`);
  }

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
