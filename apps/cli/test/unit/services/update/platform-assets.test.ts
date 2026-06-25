import { describe, expect, test } from "bun:test";

import {
  RELEASE_BINARY_TARGETS,
  detectPlatform,
  normalizePlatformArch,
  normalizePlatformOs,
  releaseAssetName,
  releaseAssetSupported,
  resolveHostReleaseBinaryTarget,
  resolveReleaseBinaryTarget,
} from "@/services/update/platform-assets";

describe("platform release assets", () => {
  test("maps unix and node platform identifiers", () => {
    expect(normalizePlatformOs("linux")).toBe("linux");
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
  });

  test("resolves the host release binary target for the current runtime", () => {
    const target = resolveHostReleaseBinaryTarget();
    expect(RELEASE_BINARY_TARGETS.some((entry) => entry.id === target.id)).toBe(true);
    expect(target.out).toBe(releaseAssetName(target.os, target.arch, target.libc ?? "gnu"));
  });
});
