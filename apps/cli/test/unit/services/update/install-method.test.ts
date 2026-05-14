import { describe, expect, test } from "bun:test";

import {
  detectInstallMethod,
  updateGuidanceForInstallMethod,
} from "@/services/update/install-method";

describe("install method detection", () => {
  test("detects source checkouts before global package layouts", () => {
    const method = detectInstallMethod({
      cwd: "/home/kitsunekode/Projects/hacking/kitsunesnipe",
      entrypoint: "/home/kitsunekode/Projects/hacking/kitsunesnipe/apps/cli/src/main.ts",
      fileExists(path) {
        return (
          path.endsWith("/package.json") ||
          path.endsWith("/apps/cli/src/main.ts") ||
          path.endsWith("/.git")
        );
      },
    });

    expect(method.kind).toBe("source");
    expect(updateGuidanceForInstallMethod(method)).toContain("git pull");
  });

  test("detects bun and npm global installs without running package managers", () => {
    expect(
      detectInstallMethod({
        cwd: "/home/user",
        entrypoint: "/home/user/.bun/install/global/node_modules/@kitsunekode/kunai/dist/kunai.js",
        fileExists: () => false,
      }).kind,
    ).toBe("bun-global");

    expect(
      detectInstallMethod({
        cwd: "/home/user",
        entrypoint: "/usr/local/lib/node_modules/@kitsunekode/kunai/dist/kunai.js",
        fileExists: () => false,
      }).kind,
    ).toBe("npm-global");
  });

  test("falls back to binary/package or unknown guidance", () => {
    const binary = detectInstallMethod({
      cwd: "/tmp",
      entrypoint: "/opt/kunai/kunai",
      fileExists: () => false,
      packagedBinary: true,
    });
    const unknown = detectInstallMethod({
      cwd: "/tmp",
      entrypoint: "/tmp/kunai.js",
      fileExists: () => false,
    });

    expect(binary.kind).toBe("binary");
    expect(updateGuidanceForInstallMethod(binary)).toMatch(/download/i);
    expect(unknown.kind).toBe("unknown");
    expect(updateGuidanceForInstallMethod(unknown)).toContain("install method");
  });
});
