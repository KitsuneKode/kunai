import type { InstallMethodKind } from "./install-method";
import {
  releaseAssetName,
  type PlatformArch,
  type PlatformLibc,
  type PlatformOs,
} from "./platform-assets";

/**
 * Pure decision logic for `kunai upgrade`: given the install channel and version
 * state, decide *what* to do without performing any network or exec side effect.
 * A thin runner (run-upgrade.ts) executes the returned plan. This split keeps the
 * routing unit-testable.
 */
export type UpgradeOs = PlatformOs;
export type UpgradeArch = PlatformArch;

export type PlanUpgradeInput = {
  readonly channel: InstallMethodKind;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly binPath: string;
  readonly dlBase: string;
  readonly os?: UpgradeOs;
  readonly arch?: UpgradeArch;
  readonly libc?: PlatformLibc;
};

export type UpgradePlan =
  | { kind: "up-to-date" }
  | { kind: "exec"; command: string[]; cwd?: string }
  | {
      kind: "self-replace";
      assetName: string;
      downloadUrl: string;
      checksumUrl: string;
      binPath: string;
    }
  | { kind: "manual"; message: string };

const PKG = "@kitsunekode/kunai";

/** Semver-ish compare limited to the `major.minor.patch` Kunai uses. */
function isNewer(latest: string, current: string): boolean {
  if (!/^\d+\.\d+\.\d+/.test(current)) return true;
  const a = latest.split(".").map((n) => Number.parseInt(n, 10));
  const b = current.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export { releaseAssetName as assetNameFor };

export function planUpgrade(input: PlanUpgradeInput): UpgradePlan {
  if (!isNewer(input.latestVersion, input.currentVersion)) return { kind: "up-to-date" };

  switch (input.channel) {
    case "npm-global":
      return { kind: "exec", command: ["npm", "i", "-g", `${PKG}@latest`] };
    case "bun-global":
      return { kind: "exec", command: ["bun", "i", "-g", `${PKG}@latest`] };
    case "source":
      return {
        kind: "manual",
        message:
          "Source checkout: run `git pull --ff-only`, then `bun install && bun run build && bun run relink:global`.",
      };
    case "binary": {
      const { os, arch, libc = "gnu" } = input;
      if (!os || !arch) {
        return { kind: "manual", message: "Could not detect OS/arch for the binary upgrade." };
      }
      const tag = `v${input.latestVersion}`;
      const asset = releaseAssetName(os, arch, libc);
      return {
        kind: "self-replace",
        assetName: asset,
        downloadUrl: `${input.dlBase}/download/${tag}/${asset}`,
        checksumUrl: `${input.dlBase}/download/${tag}/SHA256SUMS`,
        binPath: input.binPath,
      };
    }
    default:
      return { kind: "manual", message: "Unknown install method; upgrade manually." };
  }
}
