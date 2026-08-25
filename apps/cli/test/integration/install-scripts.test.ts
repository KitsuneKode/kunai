import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import { describePosixOnly as describe } from "../helpers/platform-gates";
import {
  createInstallerSandbox,
  hostInstallShAsset,
  installCommandShim,
  seedActivationLock,
  seedLifecycleLock,
  withoutKunaiPathOverrides,
  withReleaseFixture,
} from "./helpers/installer-script-harness";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const INSTALL_SH = join(REPO_ROOT, "install.sh");

async function waitForPaths(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (paths.some((path) => !existsSync(path))) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${paths.join(", ")}`);
    await Bun.sleep(10);
  }
}

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

async function runInstallShWithin(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ status: number; stdout: string; stderr: string } | null> {
  const proc = Bun.spawn(["bash", INSTALL_SH, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, status]) => ({ status, stdout, stderr }));
  const result = await Promise.race([output, Bun.sleep(timeoutMs).then(() => null)]);
  if (result === null) {
    proc.kill();
    await proc.exited;
  }
  return result;
}

type DarwinSysctlFixture = "missing" | "failing" | "0" | "1" | "unexpected";

function runInstallShForDarwin(
  machine: "arm64" | "x86_64",
  sysctlFixture?: DarwinSysctlFixture,
): { status: number | null; stdout: string; stderr: string } {
  const sandbox = createInstallerSandbox(`install-sh-darwin-${machine}`);
  try {
    const shimDir = join(sandbox.root, "shims");
    mkdirSync(shimDir, { recursive: true });
    installCommandShim(
      shimDir,
      "uname",
      `#!/bin/sh\nif [ "$1" = "-s" ]; then echo Darwin; else echo ${machine}; fi\n`,
    );
    if (sysctlFixture === "failing") {
      installCommandShim(shimDir, "sysctl", "#!/bin/sh\nexit 2\n");
    } else if (sysctlFixture !== undefined && sysctlFixture !== "missing") {
      installCommandShim(shimDir, "sysctl", `#!/bin/sh\necho ${sysctlFixture}\n`);
    }

    let path = `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`;
    if (sysctlFixture === "missing") {
      installCommandShim(shimDir, "bash", '#!/bin/sh\nexec /bin/bash "$@"\n');
      installCommandShim(shimDir, "cat", '#!/bin/sh\nexec /bin/cat "$@"\n');
      path = shimDir;
    }

    return runInstallSh(["--dry-run", "--yes", "--skip-deps", "--version", "9.8.7"], {
      ...sandbox.env,
      PATH: path,
    });
  } finally {
    sandbox.cleanup();
  }
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

  test("macOS arm64 selects and reports the darwin-arm64 target", () => {
    const result = runInstallShForDarwin("arm64");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Detected native target: darwin-arm64");
    expect(result.stdout).toContain("Downloading kunai-darwin-arm64");
  });

  test("Intel macOS selects and reports the darwin-x64 target", () => {
    const result = runInstallShForDarwin("x86_64", "0");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Detected native target: darwin-x64");
    expect(result.stdout).toContain("Downloading kunai-darwin-x64");
  });

  test("Rosetta-translated macOS selects the native darwin-arm64 target", () => {
    const result = runInstallShForDarwin("x86_64", "1");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Detected native target: darwin-arm64");
    expect(result.stdout).toContain("Downloading kunai-darwin-arm64");
  });

  test.each<readonly [string, DarwinSysctlFixture]>([
    ["missing", "missing"],
    ["failing", "failing"],
    ["non-1", "unexpected"],
  ])("%s Rosetta sysctl output safely retains darwin-x64", (_case, sysctlFixture) => {
    const result = runInstallShForDarwin("x86_64", sysctlFixture);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Detected native target: darwin-x64");
    expect(result.stdout).toContain("Downloading kunai-darwin-x64");
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
  test("does not start a download while uninstall owns the lifecycle lock", async () => {
    const sandbox = createInstallerSandbox("install-sh-lifecycle-lock");
    seedLifecycleLock(sandbox.dataDir, process.pid);
    try {
      await withReleaseFixture({}, async (baseUrl, evidence) => {
        const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
          ...sandbox.env,
          KUNAI_DL_BASE: baseUrl,
        });
        expect(result.status).not.toBe(0);
        expect(`${result.stderr}${result.stdout}`).toMatch(/lifecycle|uninstall/i);
        expect(evidence.requests).toEqual([]);
      });
    } finally {
      sandbox.cleanup();
    }
  });

  test("fails closed on a foreign-host lifecycle guard before download", async () => {
    const sandbox = createInstallerSandbox("install-sh-lifecycle-foreign");
    const path = seedLifecycleLock(sandbox.dataDir, {
      pid: 2_147_483_646,
      hostname: " Another-Host.Example ",
      external: true,
    });
    try {
      await withReleaseFixture({}, async (baseUrl, evidence) => {
        const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
          ...sandbox.env,
          KUNAI_DL_BASE: baseUrl,
        });
        expect(result.status).not.toBe(0);
        expect(`${result.stderr}${result.stdout}`).toMatch(/lifecycle|uninstall/i);
        expect(evidence.requests).toEqual([]);
        expect(existsSync(path)).toBe(true);
      });
    } finally {
      sandbox.cleanup();
    }
  });

  test("reclaims a same-host lifecycle guard whose pid start identity was reused", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho lifecycle-reused-pid\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-lifecycle-reused");
    seedLifecycleLock(sandbox.dataDir, {
      pid: process.pid,
      processStartId: "linux-proc:0",
      external: true,
    });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).toBe(0);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("gives an unchanged partial lifecycle guard bounded grace before recovery", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho lifecycle-partial\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-lifecycle-partial");
    mkdirSync(sandbox.dataDir, { recursive: true });
    writeFileSync(`${sandbox.dataDir}.lifecycle.lock`, "");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const startedAt = performance.now();
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).toBe(0);
          expect(performance.now() - startedAt).toBeGreaterThanOrEqual(400);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

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

  test("different versions download concurrently and serialize launcher plus manifest activation", async () => {
    const asset = hostInstallShAsset();
    const versions = ["9.8.7", "9.8.8"] as const;
    const bodies = {
      "9.8.7": "#!/bin/sh\necho version-9.8.7\n",
      "9.8.8": "#!/bin/sh\necho version-9.8.8\n",
    } as const;
    const sandbox = createInstallerSandbox("install-sh-activation-concurrency");
    const activationPath = seedActivationLock(sandbox.dataDir, { pid: process.pid });
    try {
      const routes = Object.fromEntries(
        versions.flatMap((version) => {
          const digest = createHash("sha256").update(bodies[version]).digest("hex");
          return [
            [`/download/v${version}/${asset}`, { body: bodies[version] }],
            [`/download/v${version}/SHA256SUMS`, { body: `${digest}  ${asset}\n` }],
          ];
        }),
      );
      await withReleaseFixture(routes, async (baseUrl) => {
        const installs = versions.map((version) =>
          runInstallShAsync(["--yes", "--skip-deps", "--version", version], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          }),
        );
        await waitForPaths(
          versions.map((version) => join(sandbox.dataDir, "versions", version, "version.json")),
        );
        const launcherBeforeRelease = existsSync(join(sandbox.binDir, "kunai"));
        const manifestBeforeRelease = existsSync(join(sandbox.configDir, "install.json"));
        rmSync(activationPath, { force: true });

        const results = await Promise.all(installs);
        expect(results.map((result) => result.status)).toEqual([0, 0]);
        expect(launcherBeforeRelease).toBe(false);
        expect(manifestBeforeRelease).toBe(false);

        const manifest = JSON.parse(
          readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
        ) as { activeVersion: string; versionedPath: string };
        expect(versions).toContain(manifest.activeVersion as (typeof versions)[number]);
        expect(manifest.versionedPath).toBe(
          join(sandbox.dataDir, "versions", manifest.activeVersion, "kunai"),
        );
        expect(readlinkSync(join(sandbox.binDir, "kunai"))).toBe(manifest.versionedPath);
        expect(existsSync(activationPath)).toBe(false);
      });
    } finally {
      sandbox.cleanup();
    }
  });

  test("reclaims a dead activation owner", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho stale-owner-reclaimed\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-activation-stale");
    const activationPath = seedActivationLock(sandbox.dataDir, { pid: 2_147_483_646 });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).toBe(0);
          expect(existsSync(activationPath)).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not elect an orphaned reclaim temp as an activation claim", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho orphan-reclaim-temp\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-orphan-reclaim-temp");
    const orphanPath = join(
      sandbox.dataDir,
      "locks",
      "activation.lock.reclaim.crashed-owner.tmp.orphan",
    );
    mkdirSync(join(sandbox.dataDir, "locks"), { recursive: true });
    writeFileSync(orphanPath, "{partial");
    const abandoned = new Date(Date.now() - 5_000);
    utimesSync(orphanPath, abandoned, abandoned);
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "60",
            KUNAI_ACTIVATION_LOCK_POLL_MS: "2",
          });
          expect(result.status).toBe(0);
          expect(existsSync(orphanPath)).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not reclaim a foreign-host activation owner", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho foreign-owner\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-activation-foreign");
    const activationPath = seedActivationLock(sandbox.dataDir, {
      pid: 2_147_483_646,
      hostname: "another-host.example",
    });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "40",
            KUNAI_ACTIVATION_LOCK_POLL_MS: "5",
          });
          expect(result.status).not.toBe(0);
          expect(JSON.parse(readFileSync(activationPath, "utf8")).hostname).toBe(
            "another-host.example",
          );
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("reclaims schema-invalid activation metadata after the corrupt grace", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho corrupt-owner\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-activation-corrupt-schema");
    const activationPath = seedActivationLock(sandbox.dataDir, {
      pid: process.pid,
      schemaVersion: 2,
    });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_CORRUPT_GRACE_MS: "10",
            KUNAI_ACTIVATION_LOCK_POLL_MS: "2",
          });
          expect(result.status).toBe(0);
          expect(existsSync(activationPath)).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("bounds activation contention after completing the version download", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho activation-timeout\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-activation-timeout");
    const activationPath = seedActivationLock(sandbox.dataDir, { pid: process.pid });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "40",
            KUNAI_ACTIVATION_LOCK_POLL_MS: "5",
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toContain("Activation lock held");
          expect(existsSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"))).toBe(true);
          expect(existsSync(activationPath)).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("bounds activation contention by real elapsed time when poll exceeds timeout", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho activation-real-deadline\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-activation-real-deadline");
    seedActivationLock(sandbox.dataDir, { pid: process.pid });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const install = runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "40",
            KUNAI_ACTIVATION_LOCK_POLL_MS: "500",
          });
          await waitForPaths([join(sandbox.dataDir, "versions", "9.8.7", "version.json")]);
          const activationStartedAt = performance.now();
          const result = await install;
          expect(result.status).not.toBe(0);
          expect(performance.now() - activationStartedAt).toBeLessThan(300);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("a failed reclaim with zero poll observes the activation deadline instead of hot-looping", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho reclaim-deadline\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-reclaim-deadline");
    seedActivationLock(sandbox.dataDir, { pid: 2_147_483_646 });
    const shimDir = join(sandbox.root, "shims");
    mkdirSync(shimDir, { recursive: true });
    const realMv = Bun.which("mv");
    if (!realMv) throw new Error("mv is required for installer integration tests");
    installCommandShim(
      shimDir,
      "mv",
      `#!/bin/sh\ncase " $* " in *.reclaim.*) exit 73 ;; esac\nexec "${realMv}" "$@"\n`,
    );
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShWithin(
            ["--yes", "--skip-deps", "--version", "9.8.7"],
            {
              ...sandbox.env,
              KUNAI_DL_BASE: baseUrl,
              KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "40",
              KUNAI_ACTIVATION_LOCK_POLL_MS: "0",
              PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
            },
            500,
          );
          expect(result).not.toBeNull();
          expect(result?.status).not.toBe(0);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("fails closed when an injected hard-link failure prevents quarantine restore", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho quarantine-restore\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-quarantine-restore-failure");
    seedActivationLock(sandbox.dataDir, { pid: 2_147_483_646 });
    const shimDir = join(sandbox.root, "shims");
    mkdirSync(shimDir, { recursive: true });
    const realMv = Bun.which("mv");
    const realLn = Bun.which("ln");
    if (!realMv || !realLn) throw new Error("mv and ln are required for installer tests");
    installCommandShim(
      shimDir,
      "mv",
      `#!/bin/sh\n"${realMv}" "$@" || exit $?\ncase "\${2:-}" in *.quarantine.*) printf ' ' >>"\${2}" ;; esac\n`,
    );
    installCommandShim(
      shimDir,
      "ln",
      `#!/bin/sh\ncase " $* " in *.quarantine.*activation.lock*) exit 74 ;; esac\nexec "${realLn}" "$@"\n`,
    );
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "100",
            KUNAI_ACTIVATION_LOCK_POLL_MS: "5",
            PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toMatch(/quarantine|activation lock/i);
          expect(existsSync(join(sandbox.configDir, "install.json"))).toBe(false);
          expect(
            readdirSync(join(sandbox.dataDir, "locks")).some((name) =>
              name.includes("activation.lock.quarantine"),
            ),
          ).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("surfaces an injected hard-link failure while releasing quarantined ownership", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho release-quarantine-restore\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-release-quarantine-failure");
    const shimDir = join(sandbox.root, "shims");
    mkdirSync(shimDir, { recursive: true });
    const realMv = Bun.which("mv");
    const realLn = Bun.which("ln");
    const realSed = Bun.which("sed");
    if (!realMv || !realLn || !realSed) {
      throw new Error("mv, ln, and sed are required for installer tests");
    }
    installCommandShim(
      shimDir,
      "mv",
      `#!/bin/sh\n"${realMv}" "$@" || exit $?\ncase "\${2:-}" in *.release.*) mutated="\${2}.mutated"; "${realSed}" 's/"ownerId":"[^"]*"/"ownerId":"injected-other-owner"/' "\${2}" >"$mutated" || exit $?; "${realMv}" "$mutated" "\${2}" ;; esac\n`,
    );
    installCommandShim(
      shimDir,
      "ln",
      `#!/bin/sh\ncase " $* " in *.release.*activation.lock*) exit 74 ;; esac\nexec "${realLn}" "$@"\n`,
    );
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toMatch(/restore activation lock quarantine/i);
          expect(
            readdirSync(join(sandbox.dataDir, "locks")).some((name) =>
              name.includes("activation.lock.quarantine"),
            ),
          ).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("releases the activation lock when manifest publication fails", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho manifest-failure\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-activation-failure");
    const activationPath = seedActivationLock(sandbox.dataDir, { pid: 2_147_483_646 });
    writeFileSync(sandbox.configDir, "not-a-directory");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(existsSync(activationPath)).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("restores the previous launcher when manifest commit fails after replacement", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho replacement\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-activation-restore");
    mkdirSync(join(sandbox.dataDir, "versions", "1.0.0"), { recursive: true });
    mkdirSync(sandbox.binDir, { recursive: true });
    mkdirSync(sandbox.configDir, { recursive: true });
    const previousPath = join(sandbox.dataDir, "versions", "1.0.0", "kunai");
    const launcher = join(sandbox.binDir, "kunai");
    writeFileSync(previousPath, "#!/bin/sh\necho previous\n", { mode: 0o755 });
    symlinkSync(previousPath, launcher);
    const manifestPath = join(sandbox.configDir, "install.json");
    const oldManifest = `${JSON.stringify(
      {
        schemaVersion: 1,
        method: "binary",
        activeVersion: "1.0.0",
        preferredChannel: "stable",
        launcherPath: launcher,
        versionedPath: previousPath,
        managedPaths: [sandbox.dataDir, sandbox.cacheDir],
        downloadBaseUrl: "https://example.test/releases",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      null,
      2,
    )}\n`;
    writeFileSync(manifestPath, oldManifest);
    chmodSync(sandbox.configDir, 0o555);
    try {
      await withReleaseFixture(
        {
          [`/download/v2.0.0/${asset}`]: { body },
          "/download/v2.0.0/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "2.0.0"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(readlinkSync(launcher)).toBe(previousPath);
          expect(readFileSync(manifestPath, "utf8")).toBe(oldManifest);
          expect(existsSync(join(sandbox.dataDir, "locks", "activation.lock"))).toBe(false);
        },
      );
    } finally {
      chmodSync(sandbox.configDir, 0o755);
      sandbox.cleanup();
    }
  });

  test("retains a flat-launcher backup when restoration itself fails", async () => {
    const asset = hostInstallShAsset();
    const body = "#!/bin/sh\necho replacement\n";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-sh-activation-restore-failure");
    mkdirSync(sandbox.binDir, { recursive: true });
    mkdirSync(sandbox.configDir, { recursive: true });
    const launcher = join(sandbox.binDir, "kunai");
    writeFileSync(launcher, "#!/bin/sh\necho legacy-flat\n", { mode: 0o755 });
    writeFileSync(
      join(sandbox.configDir, "install.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        method: "binary",
        activeVersion: "1.0.0",
        preferredChannel: "stable",
        launcherPath: launcher,
        managedPaths: [sandbox.dataDir, sandbox.cacheDir],
        downloadBaseUrl: "https://example.test/releases",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
    );
    const shimDir = join(sandbox.root, "shims");
    mkdirSync(shimDir, { recursive: true });
    const realMv = Bun.which("mv");
    if (!realMv) throw new Error("mv is required for installer integration tests");
    installCommandShim(
      shimDir,
      "mv",
      `#!/bin/sh\ncase " $* " in *.activation-backup.*) exit 73 ;; esac\nexec "${realMv}" "$@"\n`,
    );
    chmodSync(sandbox.configDir, 0o555);
    try {
      await withReleaseFixture(
        {
          [`/download/v2.0.0/${asset}`]: { body },
          "/download/v2.0.0/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallShAsync(["--yes", "--skip-deps", "--version", "2.0.0"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
          });
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Launcher restoration failed");
          expect(
            readdirSync(sandbox.binDir).some((name) => name.includes("activation-backup")),
          ).toBe(true);
        },
      );
    } finally {
      chmodSync(sandbox.configDir, 0o755);
      sandbox.cleanup();
    }
  });
});

describe("install.sh package activeVersion", () => {
  test("npm ignores stale PATH kunai, needs no Bun, and records npm-owned evidence", () => {
    const sandbox = createInstallerSandbox("install-sh-npm-version");
    try {
      const shimDir = join(sandbox.root, "shims");
      const npmRoot = join(sandbox.root, "npm-root");
      const npmPrefix = join(sandbox.root, "npm-prefix");
      mkdirSync(shimDir, { recursive: true });
      mkdirSync(join(npmRoot, "@kitsunekode", "kunai"), { recursive: true });
      writeFileSync(
        join(npmRoot, "@kitsunekode", "kunai", "package.json"),
        JSON.stringify({ name: "@kitsunekode/kunai", version: "4.5.6" }),
      );
      installCommandShim(shimDir, "node");
      installCommandShim(
        shimDir,
        "npm",
        '#!/bin/sh\ncase "$1 $2" in "root -g") echo "$KUNAI_NPM_ROOT" ;; "prefix -g") echo "$KUNAI_NPM_PREFIX" ;; esac\nexit 0\n',
      );
      installCommandShim(
        shimDir,
        "bun",
        '#!/bin/sh\necho invoked > "$KUNAI_BUN_MARKER"\nexit 99\n',
      );
      installCommandShim(shimDir, "kunai", '#!/bin/sh\necho "kunai 1.0.0 (stale-path)"\n');

      const result = runInstallSh(["--method", "npm", "--yes", "--skip-deps"], {
        ...sandbox.env,
        KUNAI_NPM_ROOT: npmRoot,
        KUNAI_NPM_PREFIX: npmPrefix,
        KUNAI_BUN_MARKER: join(sandbox.root, "bun-invoked"),
        PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
      });

      expect(result.status).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
      ) as { activeVersion: string; launcherPath: string; method: string };
      expect(manifest.method).toBe("npm-global");
      expect(manifest.activeVersion).toBe("4.5.6");
      expect(manifest.activeVersion).not.toBe("latest");
      expect(manifest.launcherPath).toBe(join(npmPrefix, "bin", "kunai"));
      expect(result.stdout).not.toContain("bun found");
      expect(existsSync(join(sandbox.root, "bun-invoked"))).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });

  test("bun ignores stale PATH kunai and records Bun-owned evidence", () => {
    const sandbox = createInstallerSandbox("install-sh-bun-version");
    try {
      const shimDir = join(sandbox.root, "shims");
      const bunRoot = join(sandbox.root, "bun-root");
      mkdirSync(shimDir, { recursive: true });
      mkdirSync(join(bunRoot, "install", "global", "node_modules", "@kitsunekode", "kunai"), {
        recursive: true,
      });
      writeFileSync(
        join(bunRoot, "install", "global", "node_modules", "@kitsunekode", "kunai", "package.json"),
        JSON.stringify({ name: "@kitsunekode/kunai", version: "7.8.9" }),
      );
      installCommandShim(shimDir, "bun", "#!/bin/sh\nexit 0\n");
      installCommandShim(shimDir, "kunai", '#!/bin/sh\necho "kunai 1.0.0 (stale-path)"\n');

      const result = runInstallSh(["--method", "bun", "--yes", "--skip-deps"], {
        ...sandbox.env,
        BUN_INSTALL: bunRoot,
        PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
      });

      expect(result.status).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
      ) as { activeVersion: string; launcherPath: string; method: string };
      expect(manifest.method).toBe("bun-global");
      expect(manifest.activeVersion).toBe("7.8.9");
      expect(manifest.activeVersion).not.toBe("latest");
      expect(manifest.launcherPath).toBe(join(bunRoot, "bin", "kunai"));
    } finally {
      sandbox.cleanup();
    }
  });

  test.each([
    ["mismatch", "4.5.7"],
    ["unverifiable", null],
  ] as const)("explicit npm %s fails before writing a manifest", (_label, observedVersion) => {
    const sandbox = createInstallerSandbox(`install-sh-npm-${_label}`);
    try {
      const shimDir = join(sandbox.root, "shims");
      const npmRoot = join(sandbox.root, "npm-root");
      mkdirSync(shimDir, { recursive: true });
      mkdirSync(join(npmRoot, "@kitsunekode", "kunai"), { recursive: true });
      if (observedVersion) {
        writeFileSync(
          join(npmRoot, "@kitsunekode", "kunai", "package.json"),
          JSON.stringify({ name: "@kitsunekode/kunai", version: observedVersion }),
        );
      }
      installCommandShim(shimDir, "node");
      installCommandShim(
        shimDir,
        "npm",
        '#!/bin/sh\ncase "$1 $2" in "root -g") echo "$KUNAI_NPM_ROOT" ;; "prefix -g") echo "$KUNAI_NPM_PREFIX" ;; esac\nexit 0\n',
      );

      const result = runInstallSh(
        ["--method", "npm", "--version", "4.5.6", "--yes", "--skip-deps"],
        {
          ...sandbox.env,
          KUNAI_NPM_ROOT: npmRoot,
          KUNAI_NPM_PREFIX: join(sandbox.root, "npm-prefix"),
          PATH: `${shimDir}${delimiter}${sandbox.env.PATH ?? ""}`,
        },
      );

      expect(result.status).not.toBe(0);
      expect(existsSync(join(sandbox.configDir, "install.json"))).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });
});

/**
 * `ask` gates `sudo apt-get/pacman/dnf install`, so what it does with no
 * terminal is a privilege decision, not a UX one. Exercised directly because
 * `--dry-run` returns before `install_optional_deps` ever prompts.
 *
 * Two separate traps, both of which defaulted to yes:
 *   - `-r /dev/tty` tests permission bits. The node is crw-rw-rw-, so it passes
 *     even with no controlling terminal, where opening it fails with ENXIO.
 *   - `read … || true` swallowed the failed read and fell through to the `y`
 *     default, so a prompt nobody could answer became consent.
 */
describe("install.sh consent without a terminal", () => {
  const setsid = Bun.which("setsid");
  const scriptBin = Bun.which("script");

  function askProbeSource(yes: 0 | 1): string {
    const source = readFileSync(INSTALL_SH, "utf8");
    const fn = /^ask\(\) \{[\s\S]*?^\}/m.exec(source)?.[0];
    if (!fn) throw new Error("could not extract ask() from install.sh");
    return [`warn() { echo "WARN: $*" >&2; }`, `YES=${yes}`, fn, `ask "Install mpv?" y`].join("\n");
  }

  function runAskWithoutControllingTerminal(yes: 0 | 1) {
    if (!setsid) throw new Error("setsid is unavailable");
    return spawnSync(setsid, ["bash", "-c", askProbeSource(yes)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2_000,
    });
  }

  function runAskWithClosedPtyInput(yes: 0 | 1) {
    if (!scriptBin) throw new Error("script(1) is unavailable");
    const root = mkdtempSync(join(tmpdir(), "kunai-ask-"));
    const probePath = join(root, "ask-probe.sh");
    try {
      writeFileSync(probePath, askProbeSource(yes), { mode: 0o700 });
      const args =
        process.platform === "darwin"
          ? ["-q", "/dev/null", "bash", probePath]
          : ["-qfec", 'bash "$KUNAI_ASK_PROBE"', "/dev/null"];
      return spawnSync(scriptBin, args, {
        encoding: "utf8",
        env: {
          ...process.env,
          ...(process.platform === "darwin" ? {} : { KUNAI_ASK_PROBE: probePath }),
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 2_000,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test.skipIf(!setsid)(
    "requires setsid: no controlling terminal declines and explains --yes",
    () => {
      const result = runAskWithoutControllingTerminal(0);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("No terminal for: Install mpv?");
      expect(result.stderr).toContain("--yes");
    },
  );

  test.skipIf(!scriptBin)(
    "requires script(1): closed PTY input declines instead of defaulting to yes",
    () => {
      const result = runAskWithClosedPtyInput(0);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("No reply for: Install mpv?");
    },
  );

  test.skipIf(!scriptBin)(
    "requires script(1): TMPDIR shell metacharacters do not change the probe",
    () => {
      const parent = mkdtempSync(join(tmpdir(), "kunai-ask-parent-"));
      let originalTmpDir: string | undefined;
      try {
        const hostileTmpDir = join(parent, "has spaces; false #");
        originalTmpDir = process.env.TMPDIR;
        mkdirSync(hostileTmpDir);
        process.env.TMPDIR = hostileTmpDir;
        expect(tmpdir()).toBe(hostileTmpDir);
        const result = runAskWithClosedPtyInput(0);
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain("No reply for: Install mpv?");
      } finally {
        if (originalTmpDir === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = originalTmpDir;
        rmSync(parent, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(!scriptBin)("requires script(1): an explicit --yes is still consent", () => {
    const result = runAskWithClosedPtyInput(1);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
  });
});

/**
 * A script cannot change its parent shell's environment, so printing PATH
 * advice was the same as doing nothing for anyone who did not already have the
 * bin directory on PATH: the install reported success and `kunai` was not
 * found. These pin the writing behaviour against a throwaway HOME — never the
 * real one.
 */
describe("install.sh PATH persistence", () => {
  function runPathHint(
    home: string,
    options: { readonly dry?: 0 | 1; readonly skip?: 0 | 1; readonly shell?: string } = {},
  ): { status: number | null; stdout: string; stderr: string } {
    const source = readFileSync(INSTALL_SH, "utf8");
    const helpers = /^KUNAI_PATH_BLOCK_BEGIN=[\s\S]*?^path_hint\(\) \{[\s\S]*?^\}/m.exec(
      source,
    )?.[0];
    if (!helpers) throw new Error("could not extract PATH helpers from install.sh");
    const script = [
      "HOST_OS=linux",
      `DRY=${options.dry ?? 0}`,
      `SKIP_PATH_UPDATE=${options.skip ?? 0}`,
      'info() { printf "> %s\\n" "$*"; }',
      'warn() { printf "! %s\\n" "$*"; }',
      helpers,
      // A PATH deliberately missing the bin dir — the case that used to no-op.
      'PATH="/usr/bin:/bin"',
      'path_hint "$HOME/.local/bin"',
    ].join("\n");
    return spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { HOME: home, SHELL: options.shell ?? "/bin/zsh", PATH: process.env.PATH ?? "" },
    });
  }

  test("writes the PATH line once, no matter how many times it runs", () => {
    const sandbox = createInstallerSandbox("install-sh-path");
    try {
      const home = sandbox.root;
      const rc = join(home, ".zshrc");
      writeFileSync(rc, '# my settings\nalias ll="ls -la"\n');

      const first = runPathHint(home);
      expect(first.status).toBe(0);
      runPathHint(home);
      runPathHint(home);

      const contents = readFileSync(rc, "utf8");
      expect(contents.match(/^# >>> kunai installer >>>$/gm)).toHaveLength(1);
      expect(contents.match(/^export PATH=/gm)).toHaveLength(1);
      // Appending must never cost the user what was already in the file.
      expect(contents).toContain('alias ll="ls -la"');
      // The activation line is the whole point of writing it.
      expect(first.stdout).toContain("source ");
    } finally {
      sandbox.cleanup();
    }
  });

  test("--skip-path-update and --dry-run both leave the rc file alone", () => {
    const sandbox = createInstallerSandbox("install-sh-path-optout");
    try {
      const home = sandbox.root;
      runPathHint(home, { skip: 1 });
      expect(existsSync(join(home, ".zshrc"))).toBe(false);
      runPathHint(home, { dry: 1 });
      expect(existsSync(join(home, ".zshrc"))).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });

  /**
   * bash splits startup by shell kind: `.bashrc` for interactive non-login (a
   * Linux terminal emulator), `.bash_profile`/`.profile` for login (macOS
   * Terminal, `bash -l`, `su -`). Debian sources `.bashrc` from `.profile`,
   * which hides the split — Alpine and macOS do not. Writing only `.bashrc`
   * there left `kunai` missing from exactly the shell the user opens;
   * reproduced in a clean Alpine container before this covered both.
   */
  test("bash gets both the interactive and the login startup file", () => {
    const sandbox = createInstallerSandbox("install-sh-path-bash");
    try {
      const home = sandbox.root;
      expect(runPathHint(home, { shell: "/bin/bash" }).status).toBe(0);

      const bashrc = readFileSync(join(home, ".bashrc"), "utf8");
      const profile = readFileSync(join(home, ".profile"), "utf8");
      expect(bashrc).toContain("kunai installer");
      expect(profile).toContain("kunai installer");
    } finally {
      sandbox.cleanup();
    }
  });

  test("an existing .bash_profile is used instead of adding a second login file", () => {
    const sandbox = createInstallerSandbox("install-sh-path-bash-profile");
    try {
      const home = sandbox.root;
      writeFileSync(join(home, ".bash_profile"), "# existing\n");
      runPathHint(home, { shell: "/bin/bash" });

      expect(readFileSync(join(home, ".bash_profile"), "utf8")).toContain("kunai installer");
      // Two login files would apply the PATH line twice on a login shell.
      expect(existsSync(join(home, ".profile"))).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });

  test("fish gets its own conf.d file using fish_add_path", () => {
    const sandbox = createInstallerSandbox("install-sh-path-fish");
    try {
      const home = sandbox.root;
      runPathHint(home, { shell: "/usr/bin/fish" });
      const conf = join(home, ".config", "fish", "conf.d", "kunai.fish");
      expect(existsSync(conf)).toBe(true);
      // `export PATH=` is not fish syntax and would error on every shell start.
      expect(readFileSync(conf, "utf8")).toContain("fish_add_path");
    } finally {
      sandbox.cleanup();
    }
  });
});
