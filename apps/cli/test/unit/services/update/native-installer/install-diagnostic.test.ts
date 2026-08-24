import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import type { InstallManifest } from "@/services/update/install-manifest";
import { getInstallDiagnostics } from "@/services/update/native-installer/install-diagnostic";
import {
  activationLockPath,
  getInstallLayoutPaths,
} from "@/services/update/native-installer/install-layout";

const binaryManifest: InstallManifest = {
  schemaVersion: 2,
  method: "binary",
  activeVersion: "0.3.0",
  preferredChannel: "stable",
  launcherPath: "/home/k/.local/bin/kunai",
  managedPaths: [],
  downloadBaseUrl: "https://example.test/releases",
  installedAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

describe("getInstallDiagnostics", () => {
  test("reports the deterministic PATH winner", async () => {
    const diagnostics = await getInstallDiagnostics({
      pathValue: "/opt/kunai/bin:/home/k/.local/bin",
      platform: "linux",
      fileExists: (path) => path === "/opt/kunai/bin/kunai",
      readManifest: async () => null,
    });

    expect(diagnostics).toEqual([
      {
        level: "info",
        code: "path-winner",
        message: "PATH resolves kunai to /opt/kunai/bin/kunai.",
      },
    ]);
  });

  test("reports multiple PATH binaries in candidate order", async () => {
    const diagnostics = await getInstallDiagnostics({
      pathValue: "/opt/kunai/bin:/home/k/.local/bin",
      platform: "linux",
      fileExists: (path) => path === "/opt/kunai/bin/kunai" || path === "/home/k/.local/bin/kunai",
      readManifest: async () => null,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "path-winner",
      "multiple-path-binaries",
    ]);
    expect(diagnostics[1]?.message).toBe("Multiple kunai binaries on PATH (2 candidates).");
  });

  test("reports a native launcher shadowed by an earlier PATH candidate", async () => {
    const diagnostics = await getInstallDiagnostics({
      pathValue: "/usr/local/bin:/home/k/.local/bin",
      platform: "linux",
      fileExists: (path) => path === "/usr/local/bin/kunai" || path === "/home/k/.local/bin/kunai",
      readManifest: async () => binaryManifest,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "path-winner",
      "multiple-path-binaries",
      "launcher-shadowed",
    ]);
    expect(diagnostics[2]?.message).toBe(
      "Native launcher /home/k/.local/bin/kunai is shadowed by /usr/local/bin/kunai.",
    );
  });

  test("reports a stale shared activation lock without reclaiming it", async () => {
    const root = await mkdtemp(join(tmpdir(), "kunai-install-diagnostic-lock-"));
    const layout = getInstallLayoutPaths({
      dataDir: join(root, "data"),
      cacheDir: join(root, "cache"),
      configDir: join(root, "config"),
      launcherPath: join(root, "bin", "kunai"),
      platform: "linux",
    });
    await mkdir(layout.locksDir, { recursive: true });
    const path = activationLockPath(layout);
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "activation",
        pid: 2_147_483_646,
        version: "1.0.0",
        execPath: "/tmp/dead-installer",
        ownerId: "dead-owner",
        acquiredAt: "2020-01-01T00:00:00.000Z",
        hostname: hostname().trim().toLowerCase(),
        processStartId: null,
      })}\n`,
    );

    try {
      const diagnostics = await getInstallDiagnostics({
        layout,
        pathValue: "",
        fileExists: () => false,
        readManifest: async () => null,
      });
      expect(diagnostics).toContainEqual({
        level: "warn",
        code: "stale-activation-lock",
        message: `Stale installer activation lock at ${path} (owner pid 2147483646 is not running).`,
      });
      expect(await Bun.file(path).exists()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
