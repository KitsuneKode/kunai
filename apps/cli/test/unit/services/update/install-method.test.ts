import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  detectInstallMethod,
  updateGuidanceForInstallMethod,
} from "@/services/update/install-method";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../../../..");

describe("install method detection", () => {
  test("detects source checkouts before global package layouts", () => {
    const method = detectInstallMethod({
      cwd: REPO_ROOT,
      entrypoint: path.join(REPO_ROOT, "apps/cli/src/main.ts"),
      fileExists(filePath) {
        return (
          filePath.endsWith(`${path.sep}package.json`) ||
          filePath.endsWith(`${path.sep}apps/cli/src/main.ts`) ||
          filePath.endsWith(`${path.sep}.git`)
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
    expect(updateGuidanceForInstallMethod(binary)).toContain("kunai upgrade");
    expect(unknown.kind).toBe("unknown");
    expect(updateGuidanceForInstallMethod(unknown)).toContain("install method");
  });
});
