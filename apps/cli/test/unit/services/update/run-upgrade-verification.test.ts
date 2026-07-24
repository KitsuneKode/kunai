import { describe, expect, test } from "bun:test";

import type {
  InstallManifest,
  WriteInstallManifestInput,
} from "../../../../src/services/update/install-manifest";
import type { PackageInstallEvidence } from "../../../../src/services/update/run-install";
import { runUpgrade, type RunUpgradePorts } from "../../../../src/services/update/run-upgrade";

const NPM_MANIFEST = {
  schemaVersion: 1,
  method: "npm-global",
  activeVersion: "1.0.0",
  preferredChannel: "stable",
  launcherPath: "/usr/local/bin/kunai",
  managedPaths: [],
  downloadBaseUrl: "https://github.com/KitsuneKode/kunai/releases",
  installedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as unknown as InstallManifest;

/** Ports that would fail loudly if the upgrade path touched the real system. */
function createPorts(overrides: Partial<RunUpgradePorts> = {}): {
  readonly ports: RunUpgradePorts;
  readonly written: WriteInstallManifestInput[];
  readonly commands: string[][];
} {
  const written: WriteInstallManifestInput[] = [];
  const commands: string[][] = [];
  const ports: RunUpgradePorts = {
    readInstallManifest: () => Promise.resolve(NPM_MANIFEST),
    resolveLatestVersion: () => Promise.resolve("2.0.0"),
    runCommand: (command) => {
      commands.push([...command]);
      return Promise.resolve(0);
    },
    inspectPackageInstall: () =>
      Promise.resolve<PackageInstallEvidence>({
        version: "2.0.0",
        launcherPath: "/npm/prefix/bin/kunai",
      }),
    writeInstallManifest: (manifest) => {
      written.push(manifest);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { ports, written, commands };
}

describe("runUpgrade package-manager verification", () => {
  test("records the version the package manager actually installed", async () => {
    const { ports, written, commands } = createPorts();

    const code = await runUpgrade({ currentVersion: "1.0.0", ports });

    expect(code).toBe(0);
    expect(commands).toEqual([["npm", "i", "-g", "@kitsunekode/kunai@latest"]]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      method: "npm-global",
      activeVersion: "2.0.0",
      launcherPath: "/npm/prefix/bin/kunai",
    });
  });

  test("records the observed version even when it differs from the resolved latest", async () => {
    // The registry can move between resolving "latest" and the install landing.
    // The manifest must describe the installed reality, not the intent.
    const { ports, written } = createPorts({
      inspectPackageInstall: () =>
        Promise.resolve<PackageInstallEvidence>({
          version: "1.9.9",
          launcherPath: "/npm/prefix/bin/kunai",
        }),
    });

    const code = await runUpgrade({ currentVersion: "1.0.0", ports });

    expect(code).toBe(0);
    expect(written[0]?.activeVersion).toBe("1.9.9");
  });

  test("refuses to write a manifest it could not verify", async () => {
    const { ports, written } = createPorts({
      inspectPackageInstall: () => Promise.resolve(null),
    });

    const code = await runUpgrade({ currentVersion: "1.0.0", ports });

    expect(code).toBe(1);
    expect(written).toHaveLength(0);
  });

  test("never verifies or writes a manifest when the package manager fails", async () => {
    let inspected = false;
    const { ports, written } = createPorts({
      runCommand: () => Promise.resolve(7),
      inspectPackageInstall: () => {
        inspected = true;
        return Promise.resolve(null);
      },
    });

    const code = await runUpgrade({ currentVersion: "1.0.0", ports });

    expect(code).toBe(7);
    expect(inspected).toBe(false);
    expect(written).toHaveLength(0);
  });

  test("does not run or record anything when already up to date", async () => {
    const { ports, written, commands } = createPorts({
      resolveLatestVersion: () => Promise.resolve("1.0.0"),
    });

    const code = await runUpgrade({ currentVersion: "1.0.0", ports });

    expect(code).toBe(0);
    expect(commands).toHaveLength(0);
    expect(written).toHaveLength(0);
  });
});
