import { describe, expect, test } from "bun:test";

import type { InstallManifest } from "@/services/update/install-manifest";
import { getInstallDiagnostics } from "@/services/update/native-installer/install-diagnostic";

const binaryManifest: InstallManifest = {
  channel: "binary",
  version: "0.3.0",
  binPath: "/home/k/.local/bin/kunai",
  dlBase: "https://example.test/releases",
  installedAt: "2026-07-20T00:00:00.000Z",
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
});
