/**
 * Frozen release asset naming contract shared by:
 *   - scripts/build-binaries.ts
 *   - install.sh / install.ps1
 *   - kunai upgrade (upgrade-planner)
 *
 * Asset names are version-agnostic; only the download base + tag change per release.
 */

export type PlatformOs = "linux" | "android" | "darwin" | "windows";
export type PlatformArch = "x64" | "arm64";
export type PlatformLibc = "gnu" | "musl" | "bionic";
export type ReleaseArchiveFormat = "tar.gz" | "zip";

const MAX_RELEASE_BINARY_BYTES = 128 * 1024 * 1024;
const MAX_RELEASE_ARCHIVE_BYTES = 64 * 1024 * 1024;

export type ReleaseBinaryTarget = {
  readonly id: string;
  readonly triple: string;
  readonly out: string;
  readonly os: PlatformOs;
  readonly arch: PlatformArch;
  readonly libc?: PlatformLibc;
  readonly archiveName: string;
  readonly archiveFormat: ReleaseArchiveFormat;
  readonly archiveEntryName: string;
  readonly archiveMode: number;
  readonly maxBinaryBytes: number;
  readonly maxArchiveBytes: number;
};

type ReleaseBinaryTargetInput = Omit<
  ReleaseBinaryTarget,
  | "archiveName"
  | "archiveFormat"
  | "archiveEntryName"
  | "archiveMode"
  | "maxBinaryBytes"
  | "maxArchiveBytes"
>;

function releaseBinaryTarget(input: ReleaseBinaryTargetInput): ReleaseBinaryTarget {
  const archiveFormat: ReleaseArchiveFormat = input.os === "windows" ? "zip" : "tar.gz";
  const archiveStem = input.out.endsWith(".exe") ? input.out.slice(0, -4) : input.out;
  return {
    ...input,
    archiveName: `${archiveStem}.${archiveFormat}`,
    archiveFormat,
    archiveEntryName: input.out,
    archiveMode: 0o755,
    maxBinaryBytes: MAX_RELEASE_BINARY_BYTES,
    maxArchiveBytes: MAX_RELEASE_ARCHIVE_BYTES,
  };
}

/** Cross-compile targets published on every GitHub Release (Linux → Android → macOS → Windows). */
export const RELEASE_BINARY_TARGETS: readonly ReleaseBinaryTarget[] = [
  releaseBinaryTarget({
    id: "linux-x64",
    triple: "bun-linux-x64",
    out: "kunai-linux-x64",
    os: "linux",
    arch: "x64",
  }),
  releaseBinaryTarget({
    id: "linux-x64-musl",
    triple: "bun-linux-x64-musl",
    out: "kunai-linux-x64-musl",
    os: "linux",
    arch: "x64",
    libc: "musl",
  }),
  releaseBinaryTarget({
    id: "linux-arm64",
    triple: "bun-linux-arm64",
    out: "kunai-linux-arm64",
    os: "linux",
    arch: "arm64",
  }),
  releaseBinaryTarget({
    id: "linux-arm64-musl",
    triple: "bun-linux-arm64-musl",
    out: "kunai-linux-arm64-musl",
    os: "linux",
    arch: "arm64",
    libc: "musl",
  }),
  releaseBinaryTarget({
    id: "android-arm64",
    triple: "bun-linux-arm64-android",
    out: "kunai-android-arm64",
    os: "android",
    arch: "arm64",
    libc: "bionic",
  }),
  releaseBinaryTarget({
    id: "android-x64",
    triple: "bun-linux-x64-android",
    out: "kunai-android-x64",
    os: "android",
    arch: "x64",
    libc: "bionic",
  }),
  releaseBinaryTarget({
    id: "darwin-x64",
    triple: "bun-darwin-x64",
    out: "kunai-darwin-x64",
    os: "darwin",
    arch: "x64",
  }),
  releaseBinaryTarget({
    id: "darwin-arm64",
    triple: "bun-darwin-arm64",
    out: "kunai-darwin-arm64",
    os: "darwin",
    arch: "arm64",
  }),
  releaseBinaryTarget({
    id: "windows-x64",
    triple: "bun-windows-x64",
    out: "kunai-windows-x64.exe",
    os: "windows",
    arch: "x64",
  }),
  releaseBinaryTarget({
    id: "windows-arm64",
    triple: "bun-windows-arm64",
    out: "kunai-windows-arm64.exe",
    os: "windows",
    arch: "arm64",
  }),
];

export type DetectedPlatform = {
  readonly os?: PlatformOs;
  readonly arch?: PlatformArch;
  readonly libc?: PlatformLibc;
};

export function normalizePlatformOs(platform: string): PlatformOs | undefined {
  if (platform === "linux") return "linux";
  if (platform === "android") return "android";
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
  const os = normalizePlatformOs(platform);
  return {
    os,
    arch: normalizePlatformArch(arch),
    libc: os === "android" ? "bionic" : os === "linux" ? libc : undefined,
  };
}

/** Published GitHub Release asset filename for the given OS/arch/libc. */
export function releaseAssetName(
  os: PlatformOs,
  arch: PlatformArch,
  libc: PlatformLibc = os === "android" ? "bionic" : "gnu",
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
  libc: PlatformLibc = os === "android" ? "bionic" : "gnu",
): boolean {
  return resolveReleaseBinaryTarget(os, arch, libc) !== undefined;
}

/** Map OS/arch/libc to the published cross-compile target, if any. */
export function resolveReleaseBinaryTarget(
  os: PlatformOs,
  arch: PlatformArch,
  libc: PlatformLibc = os === "android" ? "bionic" : "gnu",
): ReleaseBinaryTarget | undefined {
  const effectiveLibc = os === "linux" || os === "android" ? libc : "gnu";
  return RELEASE_BINARY_TARGETS.find(
    (target) =>
      target.os === os && target.arch === arch && (target.libc ?? "gnu") === effectiveLibc,
  );
}

export type HostReleaseBinaryTargetInput = {
  readonly platform?: string;
  readonly arch?: string;
  readonly libc?: PlatformLibc;
};

/**
 * Resolve the release binary target that matches this machine (or explicit overrides).
 * Throws when the host OS/arch is unknown or has no published binary.
 */
export function resolveHostReleaseBinaryTarget(
  input: HostReleaseBinaryTargetInput = {},
): ReleaseBinaryTarget {
  const detected = detectPlatform(
    input.platform ?? process.platform,
    input.arch ?? process.arch,
    input.libc ?? "gnu",
  );
  if (!detected.os || !detected.arch) {
    const platform = input.platform ?? process.platform;
    const arch = input.arch ?? process.arch;
    throw new Error(
      `[platform] unsupported host ${platform}/${arch}. ` +
        `Published targets: ${RELEASE_BINARY_TARGETS.map((t) => t.id).join(", ")}`,
    );
  }

  const libc = input.libc ?? detected.libc ?? "gnu";
  const target = resolveReleaseBinaryTarget(detected.os, detected.arch, libc);
  if (!target) {
    throw new Error(
      `[platform] no release binary for host ${detected.os}/${detected.arch}` +
        (detected.os === "linux" && libc === "musl"
          ? " (musl)"
          : detected.os === "android"
            ? " (bionic)"
            : "") +
        `. Published targets: ${RELEASE_BINARY_TARGETS.map((t) => t.id).join(", ")}`,
    );
  }
  return target;
}
