import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  detectInstallMethod,
  updateGuidanceForInstallMethod,
} from "@/services/update/install-method";
import { readManagedPackageContext } from "@/services/update/managed-package-context";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../../../..");

describe("install method detection", () => {
  test("reads valid npm and Bun managed package contexts", () => {
    expect(
      readManagedPackageContext({
        KUNAI_MANAGED_PACKAGE_MANAGER: "npm",
        KUNAI_MANAGED_PACKAGE_ROOT: "/usr/local/lib/node_modules/@kitsunekode/kunai",
      }),
    ).toEqual({
      manager: "npm",
      packageRoot: "/usr/local/lib/node_modules/@kitsunekode/kunai",
    });
    expect(
      readManagedPackageContext({
        KUNAI_MANAGED_PACKAGE_MANAGER: "bun",
        KUNAI_MANAGED_PACKAGE_ROOT:
          "C:\\Users\\k\\.bun\\install\\global\\node_modules\\@kitsunekode\\kunai",
      }),
    ).toEqual({
      manager: "bun",
      packageRoot: "C:\\Users\\k\\.bun\\install\\global\\node_modules\\@kitsunekode\\kunai",
    });
  });

  test("rejects invalid managed package contexts", () => {
    expect(
      readManagedPackageContext({
        KUNAI_MANAGED_PACKAGE_MANAGER: "pnpm",
        KUNAI_MANAGED_PACKAGE_ROOT: "/usr/local/lib/node_modules/@kitsunekode/kunai",
      }),
    ).toBeNull();
    expect(readManagedPackageContext({ KUNAI_MANAGED_PACKAGE_MANAGER: "npm" })).toBeNull();
    expect(
      readManagedPackageContext({
        KUNAI_MANAGED_PACKAGE_MANAGER: "npm",
        KUNAI_MANAGED_PACKAGE_ROOT: "",
      }),
    ).toBeNull();
    expect(
      readManagedPackageContext({
        KUNAI_MANAGED_PACKAGE_MANAGER: "bun",
        KUNAI_MANAGED_PACKAGE_ROOT: "relative/node_modules/@kitsunekode/kunai",
      }),
    ).toBeNull();
  });

  test("valid managed context wins before compiled-binary fallback and retains its root", () => {
    const packageRoot = "/usr/local/lib/node_modules/@kitsunekode/kunai";
    const npm = detectInstallMethod({
      packagedBinary: true,
      env: {
        KUNAI_MANAGED_PACKAGE_MANAGER: "npm",
        KUNAI_MANAGED_PACKAGE_ROOT: packageRoot,
      },
    });
    const bun = detectInstallMethod({
      packagedBinary: true,
      env: {
        KUNAI_MANAGED_PACKAGE_MANAGER: "bun",
        KUNAI_MANAGED_PACKAGE_ROOT:
          "C:\\Users\\k\\.bun\\install\\global\\node_modules\\@kitsunekode\\kunai",
      },
    });

    expect(npm).toEqual({ kind: "npm-global", label: "npm global", packageRoot });
    expect(bun).toEqual({
      kind: "bun-global",
      label: "Bun global",
      packageRoot: "C:\\Users\\k\\.bun\\install\\global\\node_modules\\@kitsunekode\\kunai",
    });
  });

  test("invalid managed context is ignored for compiled binaries", () => {
    expect(
      detectInstallMethod({
        packagedBinary: true,
        env: {
          KUNAI_MANAGED_PACKAGE_MANAGER: "pnpm",
          KUNAI_MANAGED_PACKAGE_ROOT: "/tmp/kunai",
        },
      }).kind,
    ).toBe("binary");
  });

  test("detects source checkouts before global package layouts", () => {
    const method = detectInstallMethod({
      cwd: REPO_ROOT,
      entrypoint: path.join(REPO_ROOT, "apps/cli/src/main.ts"),
      fileExists(filePath) {
        // Build the suffix with path.join rather than embedding "/": the real
        // path is separator-native, so a hardcoded forward slash mid-string
        // never matched on Windows and detection fell through to "unknown".
        return (
          filePath.endsWith(`${path.sep}package.json`) ||
          filePath.endsWith(path.join(path.sep, "apps", "cli", "src", "main.ts")) ||
          filePath.endsWith(`${path.sep}.git`)
        );
      },
    });

    expect(method.kind).toBe("source");
    expect(updateGuidanceForInstallMethod(method)).toContain("git pull");
  });

  test("detects a source checkout when cwd is a package directory under the repo", () => {
    const root = "/repo/kunai";
    const files = new Set([`${root}/package.json`, `${root}/apps/cli/src/main.ts`, `${root}/.git`]);

    expect(
      detectInstallMethod({
        cwd: `${root}/apps/cli`,
        entrypoint: `${root}/apps/cli/src/main.ts`,
        platform: "linux",
        fileExists: (candidate) => files.has(candidate),
      }).kind,
    ).toBe("source");
  });

  test("detects a source checkout from a script entrypoint when cwd is outside the repo", () => {
    const root = "/repo/kunai";
    const files = new Set([`${root}/package.json`, `${root}/apps/cli/src/main.ts`, `${root}/.git`]);

    expect(
      detectInstallMethod({
        cwd: "/tmp",
        entrypoint: `${root}/apps/cli/src/main.ts`,
        platform: "linux",
        fileExists: (candidate) => files.has(candidate),
      }).kind,
    ).toBe("source");
  });

  test("does not treat a compiled binary inside the tree as a source checkout via entrypoint walk", () => {
    const root = "/repo/kunai";
    const files = new Set([`${root}/package.json`, `${root}/apps/cli/src/main.ts`, `${root}/.git`]);

    expect(
      detectInstallMethod({
        cwd: "/tmp",
        entrypoint: `${root}/apps/cli/dist/bin/kunai-linux-x64`,
        platform: "linux",
        fileExists: (candidate) => files.has(candidate),
      }).kind,
    ).toBe("binary");
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

  test("detects Windows npm and Bun global entrypoints", () => {
    expect(
      detectInstallMethod({
        cwd: "C:\\Users\\k",
        entrypoint:
          "C:\\Users\\k\\AppData\\Roaming\\npm\\node_modules\\@kitsunekode\\kunai\\dist\\kunai.js",
        platform: "win32",
      }).kind,
    ).toBe("npm-global");

    expect(
      detectInstallMethod({
        cwd: "C:\\Users\\k",
        entrypoint:
          "C:\\Users\\k\\.bun\\install\\global\\node_modules\\@kitsunekode\\kunai\\dist\\kunai.js",
        platform: "win32",
      }).kind,
    ).toBe("bun-global");
  });

  test("matches Windows package paths and script extensions case-insensitively", () => {
    expect(
      detectInstallMethod({
        cwd: "C:\\Users\\k",
        entrypoint:
          "C:\\USERS\\K\\APPDATA\\ROAMING\\NPM\\NODE_MODULES\\@KITSUNEKODE\\KUNAI\\DIST\\KUNAI.JS",
        platform: "win32",
      }).kind,
    ).toBe("npm-global");

    expect(
      detectInstallMethod({
        cwd: "C:\\Users\\k",
        entrypoint: "C:\\Users\\k\\scripts\\kunai.TS",
        platform: "win32",
      }).kind,
    ).toBe("unknown");
  });

  test("detects Windows source checkouts with Windows path operations", () => {
    const cwd = "C:\\Users\\k\\src\\kunai";
    const sourceFiles = new Set([
      "C:\\Users\\k\\src\\kunai\\package.json",
      "C:\\Users\\k\\src\\kunai\\apps\\cli\\src\\main.ts",
      "C:\\Users\\k\\src\\kunai\\.git",
    ]);

    expect(
      detectInstallMethod({
        cwd,
        entrypoint: "C:\\Users\\k\\src\\kunai\\apps\\cli\\src\\main.ts",
        platform: "win32",
        fileExists: (candidate) => sourceFiles.has(candidate),
      }).kind,
    ).toBe("source");
  });

  test("detects a Windows source checkout when cwd is a package directory under the repo", () => {
    const sourceFiles = new Set([
      "C:\\Users\\k\\src\\kunai\\package.json",
      "C:\\Users\\k\\src\\kunai\\apps\\cli\\src\\main.ts",
      "C:\\Users\\k\\src\\kunai\\.git",
    ]);

    expect(
      detectInstallMethod({
        cwd: "C:\\Users\\k\\src\\kunai\\apps\\cli",
        entrypoint: "C:\\Users\\k\\src\\kunai\\apps\\cli\\src\\main.ts",
        platform: "win32",
        fileExists: (candidate) => sourceFiles.has(candidate),
      }).kind,
    ).toBe("source");
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

  test("treats compiled-binary bunfs entrypoints as packaged binaries", () => {
    // `bun build --compile` reports argv[1] from the embedded filesystem, and
    // both path forms end in .js — the suffix heuristic alone classified a
    // flat release binary as "unknown" and broke `kunai upgrade`.
    const posix = detectInstallMethod({
      cwd: "/tmp",
      entrypoint: "/$bunfs/root/kunai/apps/cli/src/main.js",
      fileExists: () => false,
      platform: "linux",
    });
    const windows = detectInstallMethod({
      cwd: "C:\\Users\\x",
      entrypoint: "B:\\~BUN\\root\\main.js",
      fileExists: () => false,
      platform: "win32",
    });

    expect(posix.kind).toBe("binary");
    expect(windows.kind).toBe("binary");
    expect(updateGuidanceForInstallMethod(posix)).toContain("kunai upgrade");
  });
});

describe("package-manager-owned binary detection", () => {
  const binaryRun = {
    cwd: "/home/user",
    entrypoint: "/$bunfs/root/main.js",
    packagedBinary: true as const,
    fileExists: () => false,
  };

  test("detects Homebrew Cellar installs across prefixes", () => {
    for (const [execPath, platform] of [
      ["/opt/homebrew/Cellar/kunai/0.3.0/bin/kunai", "darwin"],
      ["/usr/local/Cellar/kunai/0.3.0/bin/kunai", "darwin"],
      ["/home/linuxbrew/.linuxbrew/Cellar/kunai/0.3.0/bin/kunai", "linux"],
    ] as const) {
      expect(detectInstallMethod({ ...binaryRun, execPath, platform }).kind).toBe("homebrew");
    }
  });

  test("a different Cellar package is not a Homebrew kunai", () => {
    expect(
      detectInstallMethod({
        ...binaryRun,
        execPath: "/opt/homebrew/Cellar/ffmpeg/7.1/bin/ffmpeg",
        platform: "darwin",
      }).kind,
    ).toBe("binary");
  });

  test("detects Scoop installs on Windows app paths", () => {
    expect(
      detectInstallMethod({
        cwd: "C:\\Users\\k",
        entrypoint: "B:\\~BUN\\root\\main.js",
        packagedBinary: true,
        execPath: "C:\\Users\\k\\scoop\\apps\\kunai\\current\\kunai.exe",
        platform: "win32",
      }).kind,
    ).toBe("scoop");
    // POSIX-normalized scoop paths (msys/git-bash view) match too.
    expect(
      detectInstallMethod({
        ...binaryRun,
        execPath: "/c/Users/k/scoop/apps/kunai/current/kunai.exe",
        platform: "win32",
      }).kind,
    ).toBe("scoop");
  });

  test("detects distro /usr/bin/kunai as a system package on Linux only", () => {
    expect(
      detectInstallMethod({
        ...binaryRun,
        execPath: "/usr/bin/kunai",
        platform: "linux",
      }).kind,
    ).toBe("system-package");
    // A POSIX-looking path on macOS/Windows says nothing about a package manager.
    expect(
      detectInstallMethod({
        ...binaryRun,
        execPath: "/usr/bin/kunai",
        platform: "darwin",
      }).kind,
    ).toBe("binary");
    expect(
      detectInstallMethod({
        cwd: "C:\\Users\\k",
        entrypoint: "B:\\~BUN\\root\\main.js",
        packagedBinary: true,
        execPath: "C:\\usr\\bin\\kunai.exe",
        platform: "win32",
      }).kind,
    ).toBe("binary");
  });

  test("a flat self-managed binary still detects as binary", () => {
    expect(
      detectInstallMethod({
        ...binaryRun,
        execPath: "/home/user/.local/bin/kunai",
        platform: "linux",
      }).kind,
    ).toBe("binary");
  });

  test("guidance names the owning package manager", () => {
    expect(updateGuidanceForInstallMethod({ kind: "homebrew", label: "Homebrew" })).toContain(
      "brew upgrade kunai",
    );
    expect(updateGuidanceForInstallMethod({ kind: "scoop", label: "Scoop" })).toContain(
      "scoop update kunai",
    );
    expect(
      updateGuidanceForInstallMethod({ kind: "system-package", label: "System package" }),
    ).toContain("package manager");
  });
});
