import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  test("pins a resolved latest binary and checksum to the immutable release URL", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho kunai-fixture\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-latest-url");
    try {
      await withReleaseFixture(
        {
          "/releases/latest": {
            body: JSON.stringify({ tag_name: "v9.8.7" }),
            headers: { "content-type": "application/json" },
          },
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_RELEASES_API: `${baseUrl}/releases/latest`,
            PATH: `${sandbox.binDir}${delimiter}${sandbox.env.PATH ?? ""}`,
          });

          expect(result.status).toBe(0);
          expect(result.stdout).toContain(`Downloading ${asset} (v9.8.7)`);
          expect(evidence.requests).toEqual([
            "/releases/latest",
            "/download/v9.8.7/SHA256SUMS",
            `/download/v9.8.7/${asset}`,
          ]);
          expect(evidence.requests.some((path) => path.includes("/latest/download"))).toBe(false);

          const metadata = JSON.parse(
            readFileSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"), "utf8"),
          ) as { sourceUrl: string };
          expect(metadata.sourceUrl).toBe(`${baseUrl}/download/v9.8.7/${asset}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

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
        // Checksum is fetched first (parity with installLatest); 404 may name SHA256SUMS or asset.
        expect(result.stderr).toMatch(new RegExp(`${asset}|SHA256SUMS`));
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
        async (baseUrl, evidence) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            PATH: `${sandbox.binDir}${delimiter}${sandbox.env.PATH ?? ""}`,
          });
          expect(result.status).toBe(0);
          expect(result.stdout).toContain(`Downloading ${asset} (v9.8.7)`);
          expect(evidence.requests).toEqual([
            "/download/v9.8.7/SHA256SUMS",
            `/download/v9.8.7/${asset}`,
          ]);
          expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(true);
          expect(result.stdout).toContain(`PATH winner: ${join(sandbox.binDir, "kunai")}`);

          const manifest = JSON.parse(
            readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
          ) as Record<string, unknown>;
          expect(manifest.schemaVersion).toBe(1);
          expect(manifest.method).toBe("binary");
          expect(manifest.activeVersion).toBe("9.8.7");
          expect(manifest.preferredChannel).toBe("stable");
          expect(manifest.launcherPath).toBe(join(sandbox.binDir, "kunai"));
          expect(manifest.versionedPath).toBe(join(sandbox.dataDir, "versions", "9.8.7", "kunai"));
          expect(manifest.downloadBaseUrl).toBe(baseUrl);
          expect(manifest.artifactSha256).toBe(digest);
          expect(Array.isArray(manifest.managedPaths)).toBe(true);
          expect(manifest.managedPaths).toContain(sandbox.dataDir);
          expect(manifest.managedPaths).toContain(sandbox.cacheDir);
          expect(typeof manifest.installedAt).toBe("string");
          expect(typeof manifest.updatedAt).toBe("string");
          expect(existsSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"))).toBe(true);
          const versionMetadata = JSON.parse(
            readFileSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"), "utf8"),
          ) as { sourceUrl: string };
          expect(versionMetadata.sourceUrl).toBe(`${baseUrl}/download/v9.8.7/${asset}`);
          expect(existsSync(join(sandbox.dataDir, "locks"))).toBe(true);
          expect(existsSync(join(sandbox.dataDir, "transactions"))).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("install.sh lifecycle contract", () => {
  test.each(["../1.2.3", "1.2.3-beta", "01.2.3", "1.2", "v1.2.3-rc.1"])(
    "rejects invalid version %s before creating directories",
    (version) => {
      const sandbox = createInstallerSandbox(
        `install-sh-badver-${version.replace(/[^\w.-]/g, "_")}`,
      );
      try {
        const result = runInstallSh(["--yes", "--skip-deps", "--version", version], sandbox.env);
        expect(result.status).not.toBe(0);
        expect(`${result.stderr}${result.stdout}`).toMatch(/invalid|version/i);
        expect(existsSync(sandbox.binDir)).toBe(false);
        expect(existsSync(sandbox.dataDir)).toBe(false);
        expect(existsSync(sandbox.configDir)).toBe(false);
        expect(existsSync(sandbox.cacheDir)).toBe(false);
      } finally {
        sandbox.cleanup();
      }
    },
  );

  test("retries 503 then succeeds", async () => {
    const asset = hostInstallShAsset();
    const body = "#! /bin/sh\necho kunai-retry\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-503");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body,
            failuresBeforeSuccess: 1,
            failureStatus: 503,
          },
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
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not retry 404", async () => {
    const asset = hostInstallShAsset();
    const sandbox = createInstallerSandbox("install-sh-404-noretry");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body: "gone",
            status: 404,
            failuresBeforeSuccess: 0,
          },
        },
        async (baseUrl) => {
          const started = Date.now();
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_RETRY_BASE_MS: "200",
          });
          expect(result.status).not.toBe(0);
          expect(Date.now() - started).toBeLessThan(5_000);
          expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects oversized download via max-filesize", async () => {
    const asset = hostInstallShAsset();
    const oversized = "x".repeat(4096);
    const sandbox = createInstallerSandbox("install-sh-oversize");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body: oversized,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"a".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_MAX_BYTES: "1024",
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toMatch(
            /size|filesize|too large|max|Download failed|network, stall/i,
          );
          expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(false);
          // Staging txn dirs must be cleaned on failure.
          if (existsSync(join(sandbox.cacheDir, "staging"))) {
            const { readdirSync } = await import("node:fs");
            const leftover = readdirSync(join(sandbox.cacheDir, "staging"), {
              recursive: true,
            }) as string[];
            expect(leftover.filter((e) => String(e).includes(asset))).toEqual([]);
          }
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects oversized streamed body when curl exits non-zero (no Content-Length)", async () => {
    // Without Content-Length, curl --max-filesize can leave a partial file with HTTP 200
    // and exit 63. bounded_download must honor curl exit and delete the partial.
    const asset = hostInstallShAsset();
    const oversized = "x".repeat(4096);
    const sandbox = createInstallerSandbox("install-sh-oversize-chunked");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body: oversized,
            // ReadableStream response omits Content-Length → TE chunked.
            chunkDelayMs: 0,
            chunkSize: 256,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"a".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_MAX_BYTES: "1024",
            KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1",
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toMatch(
            /size|filesize|too large|max|Download failed|network, stall|curl exit/i,
          );
          expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(false);
          if (existsSync(join(sandbox.cacheDir, "staging"))) {
            const { readdirSync } = await import("node:fs");
            const leftover = readdirSync(join(sandbox.cacheDir, "staging"), {
              recursive: true,
            }) as string[];
            expect(leftover.filter((e) => String(e).includes(asset))).toEqual([]);
          }
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects stalled download and removes staging partials", async () => {
    const asset = hostInstallShAsset();
    const sandbox = createInstallerSandbox("install-sh-stall");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body: "abcdefghijklmnopqrstuvwxyz",
            chunkDelayMs: 800,
            chunkSize: 1,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"b".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_SPEED_TIME: "1",
            KUNAI_DOWNLOAD_SPEED_LIMIT: "1000",
            KUNAI_DOWNLOAD_TOTAL_SECONDS: "5",
            KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1",
          });
          expect(result.status).not.toBe(0);
          expect(existsSync(join(sandbox.binDir, "kunai"))).toBe(false);
          // Staging txn dirs must be cleaned; empty staging root is ok.
          if (existsSync(join(sandbox.cacheDir, "staging"))) {
            const { readdirSync } = await import("node:fs");
            const leftover = readdirSync(join(sandbox.cacheDir, "staging"), {
              recursive: true,
            }) as string[];
            expect(leftover.filter((e) => e.includes(asset) || e.endsWith("kunai"))).toEqual([]);
          }
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("preserves old launcher and manifest when a new install fails", async () => {
    const asset = hostInstallShAsset();
    const sandbox = createInstallerSandbox("install-sh-preserve");
    mkdirSync(sandbox.binDir, { recursive: true });
    mkdirSync(sandbox.configDir, { recursive: true });
    mkdirSync(join(sandbox.dataDir, "versions", "1.0.0"), { recursive: true });
    const oldBinary = join(sandbox.dataDir, "versions", "1.0.0", "kunai");
    const launcher = join(sandbox.binDir, "kunai");
    writeFileSync(oldBinary, "#!/bin/sh\necho old\n", { mode: 0o755 });
    writeFileSync(launcher, "", { mode: 0o755 });
    // Symlink-like: write a tiny script launcher standing in for the old install.
    writeFileSync(launcher, "#!/bin/sh\nexec echo old-launcher\n", { mode: 0o755 });
    const oldManifest = {
      schemaVersion: 1,
      method: "binary",
      activeVersion: "1.0.0",
      preferredChannel: "stable",
      launcherPath: launcher,
      versionedPath: oldBinary,
      managedPaths: [sandbox.dataDir, sandbox.cacheDir],
      downloadBaseUrl: "https://example.test/releases",
      installedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      artifactSha256: "c".repeat(64),
    };
    writeFileSync(
      join(sandbox.configDir, "install.json"),
      `${JSON.stringify(oldManifest, null, 2)}\n`,
    );
    const beforeManifest = readFileSync(join(sandbox.configDir, "install.json"), "utf8");
    const beforeLauncher = readFileSync(launcher);

    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body: "bad-payload" },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"d".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(readFileSync(join(sandbox.configDir, "install.json"), "utf8")).toBe(
            beforeManifest,
          );
          expect(readFileSync(launcher)).toEqual(beforeLauncher);
          expect(existsSync(oldBinary)).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("install.sh package activeVersion", () => {
  test("npm method resolves activeVersion from kunai --version, never latest", () => {
    const sandbox = createInstallerSandbox("install-sh-npm-version");
    try {
      const shimDir = join(sandbox.root, "shims");
      mkdirSync(shimDir, { recursive: true });
      installCommandShim(shimDir, "npm", "#!/bin/sh\nexit 0\n");
      installCommandShim(shimDir, "bun", "#!/bin/sh\nexit 0\n");
      installCommandShim(shimDir, "kunai", '#!/bin/sh\necho "kunai 4.5.6 (npm-global)"\n');

      const result = runInstallSh(["--method", "npm", "--yes", "--skip-deps"], {
        ...sandbox.env,
        PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
      });

      expect(result.status).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
      ) as { activeVersion: string; method: string };
      expect(manifest.method).toBe("npm-global");
      expect(manifest.activeVersion).toBe("4.5.6");
      expect(manifest.activeVersion).not.toBe("latest");
    } finally {
      sandbox.cleanup();
    }
  });

  test("bun method resolves activeVersion from kunai --version, never latest", () => {
    const sandbox = createInstallerSandbox("install-sh-bun-version");
    try {
      const shimDir = join(sandbox.root, "shims");
      mkdirSync(shimDir, { recursive: true });
      installCommandShim(shimDir, "bun", "#!/bin/sh\nexit 0\n");
      installCommandShim(shimDir, "kunai", '#!/bin/sh\necho "kunai 7.8.9 (bun-global)"\n');

      const result = runInstallSh(["--method", "bun", "--yes", "--skip-deps"], {
        ...sandbox.env,
        PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
      });

      expect(result.status).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
      ) as { activeVersion: string; method: string };
      expect(manifest.method).toBe("bun-global");
      expect(manifest.activeVersion).toBe("7.8.9");
      expect(manifest.activeVersion).not.toBe("latest");
    } finally {
      sandbox.cleanup();
    }
  });
});
