/**
 * Frozen release asset naming contract shared by:
 *   - scripts/build-binaries.ts
 *   - install.sh / install.ps1
 *   - kunai upgrade (upgrade-planner)
 *
 * Asset names are version-agnostic; only the download base + tag change per release.
 */

export type PlatformOs = "linux" | "darwin" | "windows";
export type PlatformArch = "x64" | "arm64";
export type PlatformLibc = "gnu" | "musl";

export type ReleaseBinaryTarget = {
  readonly id: string;
  readonly triple: string;
  readonly out: string;
  readonly os: PlatformOs;
  readonly arch: PlatformArch;
  readonly libc?: PlatformLibc;
};

/** Cross-compile targets published on every GitHub Release (grouped: Linux → macOS → Windows). */
export const RELEASE_BINARY_TARGETS: readonly ReleaseBinaryTarget[] = [
  { id: "linux-x64", triple: "bun-linux-x64", out: "kunai-linux-x64", os: "linux", arch: "x64" },
  {
    id: "linux-x64-musl",
    triple: "bun-linux-x64-musl",
    out: "kunai-linux-x64-musl",
    os: "linux",
    arch: "x64",
    libc: "musl",
  },
  {
    id: "linux-arm64",
    triple: "bun-linux-arm64",
    out: "kunai-linux-arm64",
    os: "linux",
    arch: "arm64",
  },
  {
    id: "linux-arm64-musl",
    triple: "bun-linux-arm64-musl",
    out: "kunai-linux-arm64-musl",
    os: "linux",
    arch: "arm64",
    libc: "musl",
  },
  {
    id: "darwin-x64",
    triple: "bun-darwin-x64",
    out: "kunai-darwin-x64",
    os: "darwin",
    arch: "x64",
  },
  {
    id: "darwin-arm64",
    triple: "bun-darwin-arm64",
    out: "kunai-darwin-arm64",
    os: "darwin",
    arch: "arm64",
  },
  {
    id: "windows-x64",
    triple: "bun-windows-x64",
    out: "kunai-windows-x64.exe",
    os: "windows",
    arch: "x64",
  },
  {
    id: "windows-arm64",
    triple: "bun-windows-arm64",
    out: "kunai-windows-arm64.exe",
    os: "windows",
    arch: "arm64",
  },
];

export type DetectedPlatform = {
  readonly os?: PlatformOs;
  readonly arch?: PlatformArch;
  readonly libc?: PlatformLibc;
};

export function normalizePlatformOs(platform: string): PlatformOs | undefined {
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "darwin";
  if (platform === "win32" || platform === "windows") return "windows";
  return undefined;
}

export function normalizePlatformArch(arch: string): PlatformArch | undefined {
  if (arch === "x64" || arch === "amd64") return "x64";
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  return undefined;
}

export function detectPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
  libc: PlatformLibc = "gnu",
): DetectedPlatform {
  return {
    os: normalizePlatformOs(platform),
    arch: normalizePlatformArch(arch),
    libc: normalizePlatformOs(platform) === "linux" ? libc : undefined,
  };
}

/** Published GitHub Release asset filename for the given OS/arch/libc. */
export function releaseAssetName(
  os: PlatformOs,
  arch: PlatformArch,
  libc: PlatformLibc = "gnu",
): string {
  if (os === "windows") {
    return arch === "arm64" ? "kunai-windows-arm64.exe" : "kunai-windows-x64.exe";
  }
  if (os === "linux" && libc === "musl") {
    return `kunai-linux-${arch}-musl`;
  }
  return `kunai-${os}-${arch}`;
}

export function releaseAssetSupported(
  os: PlatformOs,
  arch: PlatformArch,
  libc: PlatformLibc = "gnu",
): boolean {
  return RELEASE_BINARY_TARGETS.some(
    (target) =>
      target.os === os &&
      target.arch === arch &&
      (target.libc ?? "gnu") === (os === "linux" ? libc : "gnu"),
  );
}
