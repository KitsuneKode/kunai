import type { InstallMethodKind } from "./install-method";

/**
 * Pure decision logic for `kunai upgrade`: given the install channel and version
 * state, decide *what* to do without performing any network or exec side effect.
 * A thin runner (run-upgrade.ts) executes the returned plan. This split keeps the
 * routing unit-testable.
 */
export type UpgradeOs = "linux" | "darwin" | "windows";
export type UpgradeArch = "x64" | "arm64";

export type PlanUpgradeInput = {
  readonly channel: InstallMethodKind;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly binPath: string;
  readonly dlBase: string;
  readonly os?: UpgradeOs;
  readonly arch?: UpgradeArch;
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
  const a = latest.split(".").map((n) => Number.parseInt(n, 10));
  const b = current.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function assetNameFor(os: UpgradeOs, arch: UpgradeArch): string {
  return os === "windows" ? "kunai-windows-x64.exe" : `kunai-${os}-${arch}`;
}

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
      const { os, arch } = input;
      if (!os || !arch) {
        return { kind: "manual", message: "Could not detect OS/arch for the binary upgrade." };
      }
      const tag = `v${input.latestVersion}`;
      const asset = assetNameFor(os, arch);
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
