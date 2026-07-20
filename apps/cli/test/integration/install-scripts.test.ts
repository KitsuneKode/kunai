import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import {
  createInstallerSandbox,
  hostInstallShAsset,
  installCommandShim,
  withoutKunaiPathOverrides,
  withReleaseFixture,
} from "./helpers/installer-script-harness";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const INSTALL_SH = join(REPO_ROOT, "install.sh");

function runInstallSh(
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  return spawnSync("bash", [INSTALL_SH, ...args], { encoding: "utf8", env });
}

/** Async so Bun.serve can answer while the installer runs (spawnSync deadlocks the fixture). */
async function runInstallShAsync(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", INSTALL_SH, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { status, stdout, stderr };
}

describe("install.sh dry-run", () => {
  test("prints the binary install plan without downloading", () => {
    const result = spawnSync("bash", [INSTALL_SH, "--dry-run", "--yes"], {
      encoding: "utf8",
      env: {
        ...process.env,
        KUNAI_BIN_DIR: "/tmp/kunai-test-bin",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Kunai installer");
    expect(result.stdout).toContain("Downloading kunai-");
    expect(result.stdout).toContain("versions/");
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stderr).toBe("");
  });

  test("honors pinned --version in dry-run output", () => {
    const result = spawnSync("bash", [INSTALL_SH, "--dry-run", "--yes", "--version", "9.8.7"], {
      encoding: "utf8",
      env: { ...process.env, KUNAI_BIN_DIR: "/tmp/kunai-test-bin" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("v9.8.7");
  });

  test("dry-run is side-effect-free — creates no sandbox directories", () => {
    const sandbox = createInstallerSandbox("install-sh-dry");
    try {
      const result = runInstallSh(["--dry-run", "--yes", "--version", "9.8.7"], sandbox.env);
      expect(result.status).toBe(0);
      expect(existsSync(sandbox.binDir)).toBe(false);
      expect(existsSync(sandbox.dataDir)).toBe(false);
      expect(existsSync(sandbox.configDir)).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });

  test("macOS defaults match runtime paths", () => {
    const sandbox = createInstallerSandbox("install-sh-darwin-paths");
    try {
      const shimDir = join(sandbox.root, "shims");
      mkdirSync(shimDir, { recursive: true });
      installCommandShim(
        shimDir,
        "uname",
        '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Darwin; else echo arm64; fi\n',
      );

      const runtimePaths = getKunaiPaths({
        platform: "darwin",
        homeDir: sandbox.root,
        env: { TMPDIR: join(sandbox.root, "tmp") },
      });
      const env = withoutKunaiPathOverrides();
      env.HOME = sandbox.root;
      env.PATH = `${shimDir}${delimiter}${env.PATH ?? ""}`;

      const result = runInstallSh(["--dry-run", "--yes", "--skip-deps", "--version", "9.8.7"], env);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`${runtimePaths.dataDir}/versions/9.8.7/kunai`);
      expect(result.stdout).toContain(`${runtimePaths.configDir}/install.json`);
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects lifecycle flags — use kunai upgrade / kunai uninstall instead", () => {
    const uninstall = spawnSync("bash", [INSTALL_SH, "--uninstall"], {
      encoding: "utf8",
    });
    expect(uninstall.status).not.toBe(0);
    expect(uninstall.stderr).toContain("Unknown option");

    const upgrade = spawnSync("bash", [INSTALL_SH, "--upgrade"], {
      encoding: "utf8",
    });
    expect(upgrade.status).not.toBe(0);
    expect(upgrade.stderr).toContain("Unknown option");
  });
});

describe("install.sh release asset failures", () => {
  test("rejects an empty downloaded asset", async () => {
    const asset = hostInstallShAsset();
    const sandbox = createInstallerSandbox("install-sh-empty");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body: "" },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"0".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain(`Downloaded asset ${asset} is empty`);
          expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects a SHA256SUMS file with no matching asset entry", async () => {
    const asset = hostInstallShAsset();
    const body = "payload-bytes-for-checksum";
    const sandbox = createInstallerSandbox("install-sh-missum");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"a".repeat(64)}  other-asset\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain(`SHA256SUMS has no entry for ${asset}`);
          expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("404 guidance mentions npm, bun, source, and pinned version", async () => {
    const asset = hostInstallShAsset();
    const sandbox = createInstallerSandbox("install-sh-404");
    try {
      await withReleaseFixture({}, async (baseUrl) => {
        const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
          ...sandbox.env,
          KUNAI_DL_BASE: baseUrl,
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(asset);
        expect(result.stderr).toContain("--method npm");
        expect(result.stderr).toContain("--method bun");
        expect(result.stderr).toContain("--method source");
        expect(result.stderr).toContain("--version");
        expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(false);
      });
    } finally {
      sandbox.cleanup();
    }
  });

  test("accepts a matching checksum from the local fixture", async () => {
    const asset = hostInstallShAsset();
    const body = "#! /bin/sh\necho kunai-fixture\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-ok");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${digest}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            PATH: `${sandbox.binDir}${delimiter}${sandbox.env.PATH ?? ""}`,
          });
          expect(result.status).toBe(0);
          expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(true);
          expect(result.stdout).toContain(`PATH winner: ${join(sandbox.binDir, "kunai")}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });
});
