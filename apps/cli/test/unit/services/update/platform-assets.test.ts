import { describe, expect, test } from "bun:test";

import {
  RELEASE_BINARY_TARGETS,
  detectPlatform,
  normalizePlatformArch,
  normalizePlatformOs,
  releaseAssetName,
  releaseAssetSupported,
  resolvePlatformLibc,
  resolveHostReleaseBinaryTarget,
  resolveReleaseBinaryTarget,
} from "@/services/update/platform-assets";

describe("platform release assets", () => {
  test("selects Bionic for Android without falling through to GNU", () => {
    expect(resolvePlatformLibc("android", false)).toBe("bionic");
    expect(resolvePlatformLibc("linux", false)).toBe("gnu");
    expect(resolvePlatformLibc("linux", true)).toBe("musl");
    expect(resolvePlatformLibc("darwin", false)).toBe("gnu");
  });

  test("maps unix and node platform identifiers", () => {
    expect(normalizePlatformOs("linux")).toBe("linux");
    expect(normalizePlatformOs("android")).toBe("android");
    expect(normalizePlatformOs("win32")).toBe("windows");
    expect(normalizePlatformArch("aarch64")).toBe("arm64");
    expect(normalizePlatformArch("amd64")).toBe("x64");
  });

  test("names published assets for every release target", () => {
    for (const target of RELEASE_BINARY_TARGETS) {
      const libc = target.libc ?? "gnu";
      expect(releaseAssetName(target.os, target.arch, libc)).toBe(target.out);
      expect(releaseAssetSupported(target.os, target.arch, libc)).toBe(true);
    }
  });

  test("freezes one canonical archive contract for every raw release binary", () => {
    expect(
      RELEASE_BINARY_TARGETS.map((target) => ({
        id: target.id,
        raw: target.out,
        archive: target.archiveName,
        format: target.archiveFormat,
        entry: target.archiveEntryName,
        mode: target.archiveMode,
      })),
    ).toEqual([
      {
        id: "linux-x64",
        raw: "kunai-linux-x64",
        archive: "kunai-linux-x64.tar.gz",
        format: "tar.gz",
        entry: "kunai-linux-x64",
        mode: 0o755,
      },
      {
        id: "linux-x64-musl",
        raw: "kunai-linux-x64-musl",
        archive: "kunai-linux-x64-musl.tar.gz",
        format: "tar.gz",
        entry: "kunai-linux-x64-musl",
        mode: 0o755,
      },
      {
        id: "linux-arm64",
        raw: "kunai-linux-arm64",
        archive: "kunai-linux-arm64.tar.gz",
        format: "tar.gz",
        entry: "kunai-linux-arm64",
        mode: 0o755,
      },
      {
        id: "linux-arm64-musl",
        raw: "kunai-linux-arm64-musl",
        archive: "kunai-linux-arm64-musl.tar.gz",
        format: "tar.gz",
        entry: "kunai-linux-arm64-musl",
        mode: 0o755,
      },
      {
        id: "android-arm64",
        raw: "kunai-android-arm64",
        archive: "kunai-android-arm64.tar.gz",
        format: "tar.gz",
        entry: "kunai-android-arm64",
        mode: 0o755,
      },
      {
        id: "android-x64",
        raw: "kunai-android-x64",
        archive: "kunai-android-x64.tar.gz",
        format: "tar.gz",
        entry: "kunai-android-x64",
        mode: 0o755,
      },
      {
        id: "darwin-x64",
        raw: "kunai-darwin-x64",
        archive: "kunai-darwin-x64.tar.gz",
        format: "tar.gz",
        entry: "kunai-darwin-x64",
        mode: 0o755,
      },
      {
        id: "darwin-arm64",
        raw: "kunai-darwin-arm64",
        archive: "kunai-darwin-arm64.tar.gz",
        format: "tar.gz",
        entry: "kunai-darwin-arm64",
        mode: 0o755,
      },
      {
        id: "windows-x64",
        raw: "kunai-windows-x64.exe",
        archive: "kunai-windows-x64.zip",
        format: "zip",
        entry: "kunai-windows-x64.exe",
        mode: 0o755,
      },
      {
        id: "windows-arm64",
        raw: "kunai-windows-arm64.exe",
        archive: "kunai-windows-arm64.zip",
        format: "zip",
        entry: "kunai-windows-arm64.exe",
        mode: 0o755,
      },
    ]);

    for (const target of RELEASE_BINARY_TARGETS) {
      expect(target.maxBinaryBytes).toBeGreaterThan(0);
      expect(target.maxArchiveBytes).toBeGreaterThan(0);
      expect(target.archiveEntryName).not.toMatch(/[\\/]/);
    }
  });

  test("detects the current runtime platform when supported", () => {
    const detected = detectPlatform();
    if (detected.os && detected.arch) {
      expect(releaseAssetSupported(detected.os, detected.arch)).toBe(true);
    }
  });

  test("linux musl uses dedicated asset names", () => {
    expect(releaseAssetName("linux", "x64", "musl")).toBe("kunai-linux-x64-musl");
    expect(releaseAssetName("linux", "arm64", "musl")).toBe("kunai-linux-arm64-musl");
  });

  test("windows arm64 uses a dedicated asset name", () => {
    expect(releaseAssetName("windows", "arm64")).toBe("kunai-windows-arm64.exe");
    expect(releaseAssetName("windows", "x64")).toBe("kunai-windows-x64.exe");
  });

  test("resolves explicit release binary targets", () => {
    expect(resolveReleaseBinaryTarget("linux", "x64", "gnu")?.id).toBe("linux-x64");
    expect(resolveReleaseBinaryTarget("linux", "x64", "musl")?.id).toBe("linux-x64-musl");
    expect(resolveReleaseBinaryTarget("darwin", "arm64")?.id).toBe("darwin-arm64");
    expect(resolveReleaseBinaryTarget("windows", "x64")?.id).toBe("windows-x64");
    expect(resolveReleaseBinaryTarget("android", "arm64", "bionic")?.triple).toBe(
      "bun-linux-arm64-android",
    );
    expect(resolveReleaseBinaryTarget("android", "x64", "bionic")?.out).toBe("kunai-android-x64");
    expect(resolveReleaseBinaryTarget("linux", "arm64", "bionic")).toBeUndefined();
  });

  test("detects Android as Bionic rather than generic Linux", () => {
    expect(detectPlatform("android", "aarch64")).toEqual({
      os: "android",
      arch: "arm64",
      libc: "bionic",
    });
    expect(detectPlatform("linux", "aarch64", "gnu", { TERMUX_VERSION: "0.119.0" })).toEqual({
      os: "android",
      arch: "arm64",
      libc: "bionic",
    });
    expect(releaseAssetName("android", "arm64", "bionic")).toBe("kunai-android-arm64");
  });

  test("resolves the Android updater asset from Termux runtime markers", () => {
    expect(
      resolveHostReleaseBinaryTarget({
        platform: "linux",
        arch: "arm64",
        env: { PREFIX: "/data/data/com.termux/files/usr" },
      }).id,
    ).toBe("android-arm64");
  });

  test("resolves the host release binary target for the current runtime", () => {
    const target = resolveHostReleaseBinaryTarget();
    expect(RELEASE_BINARY_TARGETS.some((entry) => entry.id === target.id)).toBe(true);
    expect(target.out).toBe(releaseAssetName(target.os, target.arch, target.libc ?? "gnu"));
  });
});
