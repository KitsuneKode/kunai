import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

import { createReleaseArchive } from "../../scripts/build-release-archives";
import {
  createInstallerSandbox,
  installCommandShim,
  seedActivationLock,
  seedLifecycleLock,
  windowsShellEnvDefaults,
  withCommandPath,
  withReleaseFixture,
} from "./helpers/installer-script-harness";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const INSTALL_PS1 = join(REPO_ROOT, "install.ps1");

function impossibleProcessStartId(): string {
  if (process.platform === "win32") return "windows-ticks:0";
  if (process.platform === "darwin") return "darwin-ps:impossible";
  return "linux-proc:0";
}

async function waitForPaths(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (paths.some((path) => !existsSync(path))) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${paths.join(", ")}`);
    await Bun.sleep(10);
  }
}

function pwshAvailable(): boolean {
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
    encoding: "utf8",
  });
  return result.status === 0;
}

const describePwsh = pwshAvailable() ? describe : describe.skip;

// Tests that do not build their own sandbox still need install.ps1's Windows
// default directories to resolve. Rooted in the OS temp dir so a stray write
// under Linux pwsh lands somewhere disposable rather than in the repo.
const DEFAULT_SHELL_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  ...windowsShellEnvDefaults(join(tmpdir(), "kunai-pwsh-default-env")),
};

function runInstallPs1(
  args: string[],
  env: NodeJS.ProcessEnv = DEFAULT_SHELL_ENV,
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  return spawnSync("pwsh", ["-NoProfile", "-File", INSTALL_PS1, ...args], {
    encoding: "utf8",
    env,
  });
}

function runActivationProtocolProbe(body: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const root = mkdtempSync(join(tmpdir(), "kunai-pwsh-activation-probe-"));
  const probePath = join(root, "probe.ps1");
  const source = readFileSync(INSTALL_PS1, "utf8");
  const protocolEnd = source.indexOf("function New-LauncherSnapshot");
  if (protocolEnd < 0) throw new Error("Could not isolate install.ps1 activation protocol");
  writeFileSync(probePath, `${source.slice(0, protocolEnd)}\n${body}\n`);
  try {
    return spawnSync("pwsh", ["-NoProfile", "-File", probePath], {
      encoding: "utf8",
      env: {
        ...DEFAULT_SHELL_ENV,
        KUNAI_DATA_DIR: join(root, "data"),
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function installPwshCommandShim(
  root: string,
  name: string,
  contents: { unix: string; windows: string },
): void {
  if (process.platform === "win32") {
    writeFileSync(join(root, `${name}.cmd`), contents.windows);
    return;
  }
  writeFileSync(join(root, name), contents.unix, { mode: 0o755 });
}

/** Async so Bun.serve can answer while the installer runs (spawnSync deadlocks the fixture). */
async function runInstallPs1Async(
  args: string[],
  env: NodeJS.ProcessEnv = DEFAULT_SHELL_ENV,
  cwd?: string,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["pwsh", "-NoProfile", "-File", INSTALL_PS1, ...args], {
    cwd,
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

function hostWindowsAsset(): string {
  return process.arch === "arm64" ? "kunai-windows-arm64.exe" : "kunai-windows-x64.exe";
}

function hostWindowsTarget() {
  const asset = hostWindowsAsset();
  const target = RELEASE_BINARY_TARGETS.find((candidate) => candidate.out === asset);
  if (!target) throw new Error(`Missing release target for ${asset}`);
  return target;
}

function rewriteZipNames(archive: Uint8Array, replacement: string): Uint8Array {
  const output = new Uint8Array(archive);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const localNameLength = view.getUint16(26, true);
  const name = new TextEncoder().encode(
    replacement.padEnd(localNameLength, "x").slice(0, localNameLength),
  );
  output.set(name, 30);
  const centralOffset = 30 + localNameLength + view.getUint32(18, true);
  output.set(name, centralOffset + 46);
  return output;
}

function invalidZipArchive(
  kind:
    | "absolute"
    | "corrupt"
    | "extra"
    | "missing"
    | "reparse"
    | "symlink"
    | "traversal"
    | "wrong",
  canonical: Uint8Array,
): Uint8Array {
  if (kind === "corrupt") return new TextEncoder().encode("not-a-zip-archive");
  if (kind === "missing") {
    const empty = new Uint8Array(22);
    new DataView(empty.buffer).setUint32(0, 0x06054b50, true);
    return empty;
  }
  if (kind === "absolute") return rewriteZipNames(canonical, "C:\\kunai.exe");
  if (kind === "traversal") return rewriteZipNames(canonical, "../kunai.exe");
  if (kind === "wrong") return rewriteZipNames(canonical, "wrong.exe");
  const output = new Uint8Array(canonical);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  if (kind === "extra") {
    view.setUint16(output.length - 14, 2, true);
    view.setUint16(output.length - 12, 2, true);
    return output;
  }
  const centralOffset = 30 + view.getUint16(26, true) + view.getUint32(18, true);
  const attributes = view.getUint32(centralOffset + 38, true);
  view.setUint32(
    centralOffset + 38,
    kind === "symlink" ? (0o120777 << 16) >>> 0 : attributes | 0x400,
    true,
  );
  return output;
}

describePwsh("install.ps1 dry-run", () => {
  test("prints the binary install plan without downloading", () => {
    const result = runInstallPs1(["-DryRun", "-Yes", "-SkipDeps"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Kunai installer");
    expect(result.stdout).toContain("Downloading kunai-windows-");
    expect(result.stdout).toContain("versions");
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stderr).toBe("");
  });

  test("honors pinned -Version in dry-run output", () => {
    const result = runInstallPs1(["-DryRun", "-Yes", "-SkipDeps", "-Version", "9.8.7"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("v9.8.7");
  });

  test("dry-run is side-effect-free — creates no sandbox directories", () => {
    const sandbox = createInstallerSandbox("install-ps1-dry");
    try {
      const result = runInstallPs1(
        ["-DryRun", "-Yes", "-SkipDeps", "-Version", "9.8.7"],
        sandbox.env,
      );
      expect(result.status).toBe(0);
      expect(existsSync(sandbox.binDir)).toBe(false);
      expect(existsSync(sandbox.dataDir)).toBe(false);
      expect(existsSync(sandbox.configDir)).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects -Uninstall — use kunai uninstall instead", () => {
    const uninstall = runInstallPs1(["-Uninstall"]);
    expect(uninstall.status).not.toBe(0);
    expect(`${uninstall.stderr}${uninstall.stdout}`).toMatch(/Uninstall|parameter/i);
  });

  test("rejects -Upgrade — use kunai upgrade instead", () => {
    const upgrade = runInstallPs1(["-Upgrade"]);
    expect(upgrade.status).not.toBe(0);
    expect(`${upgrade.stderr}${upgrade.stdout}`).toMatch(/Upgrade|parameter/i);
  });

  test("dry-run dependency plan reaches both mpv and yt-dlp when winget is present", () => {
    const sandbox = createInstallerSandbox("install-ps1-deps");
    installCommandShim(sandbox.root, "winget");
    try {
      // Deliberately no -SkipDeps: this case exists to prove the dependency plan
      // is reached. -DryRun keeps it a plan, so no winget process is spawned.
      const result = runInstallPs1(
        ["-DryRun", "-Yes", "-Version", "9.8.7"],
        withCommandPath(sandbox.env, sandbox.root),
      );

      expect(result.status).toBe(0);
      // mpv.net ships mpvnet.exe; Kunai probes for `mpv`. See the winget id note
      // in install.ps1 — this asserts the installer stays on real mpv.
      expect(result.stdout).toContain("winget install --id mpv-player.mpv-CI.MSVC -e");
      expect(result.stdout).not.toContain("mpv.net");
      expect(result.stdout).toContain("winget install yt-dlp");
    } finally {
      sandbox.cleanup();
    }
  });
});

describePwsh("install.ps1 activation identity", () => {
  test("caps an activation poll to the remaining deadline", () => {
    const result = runActivationProtocolProbe(String.raw`
      $script:ActivationLockTimeoutMs = 40
      $script:ActivationLockPollMs = 10000
      $timer = [System.Diagnostics.Stopwatch]::StartNew()
      Wait-ActivationLockPoll $timer
      Write-Output $timer.ElapsedMilliseconds
    `);

    expect(result.status).toBe(0);
    const elapsedMs = Number(result.stdout.trim());
    expect(elapsedMs).toBeGreaterThanOrEqual(10);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  test("treats a case-only raw successor as changed during reclaim", () => {
    const result = runActivationProtocolProbe(String.raw`
      $lockPath = Join-Path $env:KUNAI_DATA_DIR 'locks/activation.lock'
      New-Item -ItemType Directory -Force -Path (Split-Path $lockPath) | Out-Null
      $record = [ordered]@{
        schemaVersion = 1
        scope = 'activation'
        pid = 2147483646
        version = '1.0.0'
        execPath = 'old-installer'
        ownerId = 'case-owner'
        acquiredAt = '2020-01-01T00:00:00.000Z'
        hostname = (Get-ActivationLockHostname)
        processStartId = $null
      }
      $observedRaw = (($record | ConvertTo-Json -Compress) + [Environment]::NewLine)
      $actualRaw = $observedRaw.Replace('case-owner', 'CASE-OWNER')
      [System.IO.File]::WriteAllText($lockPath, $actualRaw, (New-Object System.Text.UTF8Encoding $false))
      $successorBytes = (New-Object System.Text.UTF8Encoding $false).GetBytes(
        $observedRaw.Replace('case-owner', 'successor-owner')
      )
      $timer = [System.Diagnostics.Stopwatch]::StartNew()
      $reclaimed = Move-ActivationLockToQuarantine $lockPath $observedRaw $false 'probe-owner' $successorBytes $timer
      $remaining = [System.IO.File]::ReadAllText($lockPath)
      Write-Output ("{0}|{1}" -f $reclaimed, $remaining.Contains('CASE-OWNER'))
    `);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("False|True");
  });

  test("does not release a case-only different owner token", () => {
    const result = runActivationProtocolProbe(String.raw`
      $lockPath = Join-Path $env:KUNAI_DATA_DIR 'locks/activation.lock'
      New-Item -ItemType Directory -Force -Path (Split-Path $lockPath) | Out-Null
      $record = [ordered]@{
        schemaVersion = 1
        scope = 'activation'
        pid = $PID
        version = '1.0.0'
        execPath = 'current-installer'
        ownerId = 'CaseOwner'
        acquiredAt = '2020-01-01T00:00:00.000Z'
        hostname = (Get-ActivationLockHostname)
        processStartId = $null
      }
      [System.IO.File]::WriteAllText(
        $lockPath,
        (($record | ConvertTo-Json -Compress) + [Environment]::NewLine),
        (New-Object System.Text.UTF8Encoding $false)
      )
      Release-ActivationLock $lockPath 'caseowner'
      $remaining = Read-ActivationLock $lockPath
      $owner = if ($null -eq $remaining) { 'missing' } else { [string]$remaining.ownerId }
      Write-Output ("{0}|{1}" -f (Test-Path -LiteralPath $lockPath), $owner)
    `);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("True|CaseOwner");
  });
});

describePwsh("install.ps1 release asset failures", () => {
  test("installs the verified zip member and records archive provenance", async () => {
    const target = hostWindowsTarget();
    const body = "MZ-archived-kunai";
    const archive = createReleaseArchive(target, new TextEncoder().encode(body));
    const binaryDigest = createHash("sha256").update(body).digest("hex");
    const archiveDigest = createHash("sha256").update(archive).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-archive-ok");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${target.archiveName}`]: { body: archive },
          "/download/v9.8.7/SHA256SUMS.archives": {
            body: `${archiveDigest}  ${target.archiveName}\n`,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${binaryDigest}  ${target.out}\n`,
          },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });

          expect(result.status, `${result.stderr}${result.stdout}`).toBe(0);
          expect(evidence.requests).toEqual([
            "/download/v9.8.7/SHA256SUMS.archives",
            `/download/v9.8.7/${target.archiveName}`,
            "/download/v9.8.7/SHA256SUMS",
          ]);
          expect(
            readFileSync(join(sandbox.dataDir, "versions", "9.8.7", "kunai.exe"), "utf8"),
          ).toBe(body);
          const manifest = JSON.parse(
            readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
          ) as Record<string, unknown>;
          expect(manifest).toMatchObject({
            schemaVersion: 2,
            artifactName: target.out,
            artifactSha256: binaryDigest,
            artifactSizeBytes: Buffer.byteLength(body),
            archiveName: target.archiveName,
            archiveSha256: archiveDigest,
            archiveSizeBytes: archive.length,
            archiveSourceUrl: `${baseUrl}/download/v9.8.7/${target.archiveName}`,
          });
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test.each([
    "absolute",
    "corrupt",
    "extra",
    "missing",
    "reparse",
    "symlink",
    "traversal",
    "wrong",
  ] as const)("rejects a %s zip archive without raw fallback or residue", async (kind) => {
    const target = hostWindowsTarget();
    const body = "MZ-safe-windows-binary";
    const canonical = createReleaseArchive(target, new TextEncoder().encode(body));
    const archive = invalidZipArchive(kind, canonical);
    const archiveDigest = createHash("sha256").update(archive).digest("hex");
    const binaryDigest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox(`install-ps1-archive-${kind}`);
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${target.archiveName}`]: { body: archive },
          "/download/v9.8.7/SHA256SUMS.archives": {
            body: `${archiveDigest}  ${target.archiveName}\n`,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${binaryDigest}  ${target.out}\n`,
          },
          [`/download/v9.8.7/${target.out}`]: { body: "LEGACY-RAW-MUST-NOT-RUN" },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });

          expect(result.status).not.toBe(0);
          expect(evidence.requests).not.toContain(`/download/v9.8.7/${target.out}`);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
          expect(existsSync(join(sandbox.configDir, "install.json"))).toBe(false);
          expect(existsSync(join(sandbox.cacheDir, "staging", "9.8.7"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects zip checksum mismatch without raw fallback", async () => {
    const target = hostWindowsTarget();
    const archive = createReleaseArchive(target, new TextEncoder().encode("MZ-mismatch"));
    const sandbox = createInstallerSandbox("install-ps1-archive-mismatch");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${target.archiveName}`]: { body: archive },
          "/download/v9.8.7/SHA256SUMS.archives": {
            body: `${"0".repeat(64)}  ${target.archiveName}\n`,
          },
          [`/download/v9.8.7/${target.out}`]: { body: "legacy" },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toContain(
            `Checksum mismatch for ${target.archiveName}`,
          );
          expect(evidence.requests).not.toContain(`/download/v9.8.7/${target.out}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects zip archive and decompressed size bombs and cleans staging", async () => {
    const target = hostWindowsTarget();
    const body = "MZ-binary-larger-than-four-bytes";
    const archive = createReleaseArchive(target, new TextEncoder().encode(body));
    const archiveDigest = createHash("sha256").update(archive).digest("hex");
    const binaryDigest = createHash("sha256").update(body).digest("hex");
    for (const [label, env] of [
      ["archive", { KUNAI_DOWNLOAD_ARCHIVE_MAX_BYTES: "8" }],
      ["decompressed", { KUNAI_EXTRACTED_BINARY_MAX_BYTES: "4" }],
    ] as const) {
      const sandbox = createInstallerSandbox(`install-ps1-${label}-bomb`);
      try {
        await withReleaseFixture(
          {
            [`/download/v9.8.7/${target.archiveName}`]: { body: archive },
            "/download/v9.8.7/SHA256SUMS.archives": {
              body: `${archiveDigest}  ${target.archiveName}\n`,
            },
            "/download/v9.8.7/SHA256SUMS": {
              body: `${binaryDigest}  ${target.out}\n`,
            },
          },
          async (baseUrl) => {
            const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
              ...sandbox.env,
              ...env,
              KUNAI_DL_BASE: baseUrl,
              KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1",
            });
            expect(result.status).not.toBe(0);
            expect(`${result.stderr}${result.stdout}`).toMatch(/size|budget|exceeds/i);
            expect(existsSync(join(sandbox.cacheDir, "staging", "9.8.7"))).toBe(false);
          },
        );
      } finally {
        sandbox.cleanup();
      }
    }
  });

  test.each([
    ["checksum", 404],
    ["checksum", 410],
    ["archive", 404],
    ["archive", 410],
  ] as const)(
    "falls back to the legacy raw zip asset only for %s HTTP %i",
    async (missing, status) => {
      const target = hostWindowsTarget();
      const body = "MZ-legacy-raw-fallback";
      const canonical = createReleaseArchive(target, new TextEncoder().encode(body));
      const archiveDigest = createHash("sha256").update(canonical).digest("hex");
      const binaryDigest = createHash("sha256").update(body).digest("hex");
      const sandbox = createInstallerSandbox(`install-ps1-fallback-${missing}-${status}`);
      try {
        await withReleaseFixture(
          {
            [`/download/v9.8.7/${target.archiveName}`]:
              missing === "archive" ? { status } : { body: canonical },
            "/download/v9.8.7/SHA256SUMS.archives":
              missing === "checksum"
                ? { status }
                : { body: `${archiveDigest}  ${target.archiveName}\n` },
            "/download/v9.8.7/SHA256SUMS": {
              body: `${binaryDigest}  ${target.out}\n`,
            },
            [`/download/v9.8.7/${target.out}`]: { body },
          },
          async (baseUrl, evidence) => {
            const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
              ...sandbox.env,
              KUNAI_DL_BASE: baseUrl,
            });
            expect(result.status, `${result.stderr}${result.stdout}`).toBe(0);
            expect(evidence.requests).toContain(`/download/v9.8.7/${target.out}`);
            expect(
              readFileSync(join(sandbox.dataDir, "versions", "9.8.7", "kunai.exe"), "utf8"),
            ).toBe(body);
          },
        );
      } finally {
        sandbox.cleanup();
      }
    },
  );

  test("does not use raw fallback for archive checksum HTTP 500", async () => {
    const target = hostWindowsTarget();
    const sandbox = createInstallerSandbox("install-ps1-archive-500");
    try {
      await withReleaseFixture(
        {
          "/download/v9.8.7/SHA256SUMS.archives": { status: 500 },
          [`/download/v9.8.7/${target.out}`]: { body: "legacy" },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1",
          });
          expect(result.status).not.toBe(0);
          expect(evidence.requests).not.toContain(`/download/v9.8.7/${target.out}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not use raw fallback when the archive checksum download stalls", async () => {
    const target = hostWindowsTarget();
    const sandbox = createInstallerSandbox("install-ps1-archive-stall");
    try {
      await withReleaseFixture(
        {
          "/download/v9.8.7/SHA256SUMS.archives": {
            body: `${"a".repeat(64)}  ${target.archiveName}\n`,
            chunkDelayMs: 150,
            chunkSize: 1,
          },
          [`/download/v9.8.7/${target.out}`]: { body: "legacy" },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1",
            KUNAI_DOWNLOAD_STALL_MS: "50",
          });
          expect(result.status).not.toBe(0);
          expect(evidence.requests).not.toContain(`/download/v9.8.7/${target.out}`);
          expect(existsSync(join(sandbox.cacheDir, "staging", "9.8.7"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("pins a resolved latest binary and checksum to the immutable release URL", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-latest-fixture-payload";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-latest-url");
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
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_RELEASES_API: `${baseUrl}/releases/latest`,
          });

          expect(result.status).toBe(0);
          expect(result.stdout).toContain(`Downloading ${asset} (v9.8.7)`);
          expect(result.stdout).toContain("PATH activation is environment-managed");
          expect(evidence.requests).toEqual([
            "/releases/latest",
            "/download/v9.8.7/SHA256SUMS.archives",
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
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-empty");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body: "" },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"0".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toContain(
            `Downloaded asset ${asset} is empty`,
          );
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects a SHA256SUMS file with no matching asset entry", async () => {
    const asset = hostWindowsAsset();
    const body = "payload-bytes-for-checksum";
    const sandbox = createInstallerSandbox("install-ps1-missum");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"a".repeat(64)}  other-asset\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toContain(
            `SHA256SUMS has no entry for ${asset}`,
          );
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("404 guidance mentions npm, bun, source, and pinned version", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-404");
    try {
      await withReleaseFixture({}, async (baseUrl) => {
        const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
          ...sandbox.env,
          KUNAI_DL_BASE: baseUrl,
        });
        expect(result.status).not.toBe(0);
        const combined = `${result.stderr}${result.stdout}`;
        // Checksum is fetched first (parity with installLatest); 404 may name SHA256SUMS or asset.
        expect(combined).toMatch(new RegExp(`${asset}|SHA256SUMS`, "i"));
        expect(combined).toMatch(/-Method npm/i);
        expect(combined).toMatch(/-Method bun/i);
        expect(combined).toMatch(/-Method source/i);
        expect(combined).toMatch(/-Version/i);
        expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
      });
    } finally {
      sandbox.cleanup();
    }
  });

  test("accepts a matching checksum from the local fixture", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-fixture-payload";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-ok");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${digest}  ${asset}\n`,
          },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).toBe(0);
          expect(result.stdout).toContain(`Downloading ${asset} (v9.8.7)`);
          expect(evidence.requests).toEqual([
            "/download/v9.8.7/SHA256SUMS.archives",
            "/download/v9.8.7/SHA256SUMS",
            `/download/v9.8.7/${asset}`,
          ]);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(true);

          const manifest = JSON.parse(
            readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
          ) as Record<string, unknown>;
          expect(manifest.schemaVersion).toBe(2);
          expect(manifest.method).toBe("binary");
          expect(manifest.activeVersion).toBe("9.8.7");
          expect(manifest.preferredChannel).toBe("stable");
          expect(manifest.launcherPath).toBe(join(sandbox.binDir, "kunai.exe"));
          expect(manifest.versionedPath).toBe(
            join(sandbox.dataDir, "versions", "9.8.7", "kunai.exe"),
          );
          expect(manifest.downloadBaseUrl).toBe(baseUrl);
          expect(manifest.artifactSha256).toBe(digest);
          expect(manifest.artifactName).toBe(asset);
          expect(manifest.artifactSizeBytes).toBe(Buffer.byteLength(body));
          expect(Array.isArray(manifest.managedPaths)).toBe(true);
          expect(existsSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"))).toBe(true);
          const versionMetadata = JSON.parse(
            readFileSync(join(sandbox.dataDir, "versions", "9.8.7", "version.json"), "utf8"),
          ) as { sourceUrl: string };
          expect(versionMetadata.sourceUrl).toBe(`${baseUrl}/download/v9.8.7/${asset}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });
});

describePwsh("install.ps1 lifecycle contract", () => {
  test("does not start a download while uninstall owns the lifecycle lock", async () => {
    const sandbox = createInstallerSandbox("install-ps1-lifecycle-lock");
    seedLifecycleLock(sandbox.dataDir, process.pid);
    try {
      await withReleaseFixture({}, async (baseUrl, evidence) => {
        const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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
    const sandbox = createInstallerSandbox("install-ps1-lifecycle-foreign");
    const path = seedLifecycleLock(sandbox.dataDir, {
      pid: 2_147_483_646,
      hostname: " Another-Host.Example ",
      external: true,
    });
    try {
      await withReleaseFixture({}, async (baseUrl, evidence) => {
        const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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
    const asset = hostWindowsAsset();
    const body = "MZ-lifecycle-reused-pid";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-lifecycle-reused");
    seedLifecycleLock(sandbox.dataDir, {
      pid: process.pid,
      processStartId: impossibleProcessStartId(),
      external: true,
    });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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
    const asset = hostWindowsAsset();
    const body = "MZ-lifecycle-partial";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-lifecycle-partial");
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
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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

  test.each(["../1.2.3", "1.2.3-beta", "01.2.3", "1.2"])(
    "rejects invalid version %s before creating directories",
    (version) => {
      const sandbox = createInstallerSandbox(
        `install-ps1-badver-${version.replace(/[^\w.-]/g, "_")}`,
      );
      try {
        const result = runInstallPs1(["-Yes", "-Version", version], sandbox.env);
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
    const asset = hostWindowsAsset();
    const body = "MZ-retry-payload";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-503");
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
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });
          expect(result.status).toBe(0);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not retry 404", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-404-noretry");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: {
            body: "gone",
            status: 404,
          },
        },
        async (baseUrl) => {
          const started = Date.now();
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_RETRY_BASE_MS: "200",
          });
          expect(result.status).not.toBe(0);
          expect(Date.now() - started).toBeLessThan(5_000);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects oversized download via max bytes", async () => {
    const asset = hostWindowsAsset();
    const oversized = "x".repeat(4096);
    const sandbox = createInstallerSandbox("install-ps1-oversize");
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
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_MAX_BYTES: "1024",
          });
          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toMatch(/size|too large|max|Download failed/i);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("rejects stalled download and removes staging partials", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-stall");
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
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_DOWNLOAD_STALL_MS: "500",
            KUNAI_DOWNLOAD_TOTAL_SECONDS: "5",
            KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1",
          });
          expect(result.status).not.toBe(0);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("preserves old launcher and manifest when a new install fails", async () => {
    const asset = hostWindowsAsset();
    const sandbox = createInstallerSandbox("install-ps1-preserve");
    mkdirSync(sandbox.binDir, { recursive: true });
    mkdirSync(sandbox.configDir, { recursive: true });
    mkdirSync(join(sandbox.dataDir, "versions", "1.0.0"), { recursive: true });
    const oldBinary = join(sandbox.dataDir, "versions", "1.0.0", "kunai.exe");
    const launcher = join(sandbox.binDir, "kunai.exe");
    writeFileSync(oldBinary, "MZ-old-binary");
    writeFileSync(launcher, "MZ-old-launcher");
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
          [`/download/v9.8.7/${asset}`]: { body: "MZ-bad-payload" },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"d".repeat(64)}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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
    const asset = hostWindowsAsset();
    const versions = ["9.8.7", "9.8.8"] as const;
    const bodies = {
      "9.8.7": "MZ-version-9.8.7",
      "9.8.8": "MZ-version-9.8.8",
    } as const;
    const sandbox = createInstallerSandbox("install-ps1-activation-concurrency");
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
          runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", version], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          }),
        );
        await waitForPaths(
          versions.map((version) => join(sandbox.dataDir, "versions", version, "version.json")),
        );
        const launcherBeforeRelease = existsSync(join(sandbox.binDir, "kunai.exe"));
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
          join(sandbox.dataDir, "versions", manifest.activeVersion, "kunai.exe"),
        );
        expect(readFileSync(join(sandbox.binDir, "kunai.exe"))).toEqual(
          readFileSync(manifest.versionedPath),
        );
        expect(existsSync(activationPath)).toBe(false);
      });
    } finally {
      sandbox.cleanup();
    }
  });

  test("reclaims a dead activation owner", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-stale-owner-reclaimed";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-activation-stale");
    const activationPath = seedActivationLock(sandbox.dataDir, { pid: 2_147_483_646 });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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

  test("elects its reclaim claim across lexical path aliases", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-relative-lock-path";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-activation-relative-path");
    const activationPath = seedActivationLock(sandbox.dataDir, { pid: 2_147_483_646 });
    const sandboxRoot = dirname(sandbox.dataDir);
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(
            ["-Yes", "-SkipDeps", "-Version", "9.8.7"],
            {
              ...sandbox.env,
              KUNAI_DATA_DIR: basename(sandbox.dataDir),
              KUNAI_DL_BASE: baseUrl,
            },
            sandboxRoot,
          );
          expect(result.status).toBe(0);
          expect(existsSync(activationPath)).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not elect an orphaned reclaim temp as an activation claim", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-orphan-reclaim-temp";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-orphan-reclaim-temp");
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
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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

  test("timeout zero does not enter reclaim retry for a dead owner", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-zero-timeout-reclaim";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-zero-timeout-reclaim");
    const activationPath = seedActivationLock(sandbox.dataDir, {
      pid: 2_147_483_646,
      ownerId: "dead-owner-must-remain",
    });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const install = runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "0",
            KUNAI_ACTIVATION_LOCK_POLL_MS: "1",
          });
          await waitForPaths([join(sandbox.dataDir, "versions", "9.8.7", "version.json")]);
          const result = await install;
          expect(result.status).not.toBe(0);
          expect(JSON.parse(readFileSync(activationPath, "utf8")).ownerId).toBe(
            "dead-owner-must-remain",
          );
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not reclaim a foreign-host activation owner", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-foreign-owner";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-activation-foreign");
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
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "40",
            KUNAI_ACTIVATION_LOCK_POLL_MS: "0",
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
    const asset = hostWindowsAsset();
    const body = "MZ-corrupt-owner";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-activation-corrupt-schema");
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
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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
    const asset = hostWindowsAsset();
    const body = "MZ-activation-timeout";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-activation-timeout");
    const activationPath = seedActivationLock(sandbox.dataDir, { pid: process.pid });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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
    const asset = hostWindowsAsset();
    const body = "MZ-activation-real-deadline";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-activation-real-deadline");
    seedActivationLock(sandbox.dataDir, { pid: process.pid });
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const install = runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "40",
            // Keep the mutation signal far above ordinary Windows scheduling
            // noise: an unbounded poll would sleep for ten seconds.
            KUNAI_ACTIVATION_LOCK_POLL_MS: "10000",
          });
          await waitForPaths([join(sandbox.dataDir, "versions", "9.8.7", "version.json")]);
          const activationStartedAt = performance.now();
          const result = await install;
          expect(result.status).not.toBe(0);
          expect(performance.now() - activationStartedAt).toBeLessThan(5_000);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("releases the activation lock when manifest publication fails", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-manifest-failure";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-activation-failure");
    const activationPath = seedActivationLock(sandbox.dataDir, { pid: 2_147_483_646 });
    writeFileSync(sandbox.configDir, "not-a-directory");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": { body: `${digest}  ${asset}\n` },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
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

  // A read-only config directory is what makes the manifest commit fail here.
  // Windows ignores POSIX mode bits and root bypasses them, so on either the
  // write succeeds and the test asserts a failure that never happened. Skip
  // where the precondition cannot hold rather than weaken the fixture.
  const canDenyWriteByMode = process.platform !== "win32" && (process.getuid?.() ?? 0) !== 0;
  const testPosixPwsh = canDenyWriteByMode ? test : test.skip;
  testPosixPwsh(
    "restores the previous launcher when manifest commit fails after replacement",
    async () => {
      const asset = hostWindowsAsset();
      const body = "MZ-replacement";
      const digest = createHash("sha256").update(body).digest("hex");
      const sandbox = createInstallerSandbox("install-ps1-activation-restore");
      mkdirSync(join(sandbox.dataDir, "versions", "1.0.0"), { recursive: true });
      mkdirSync(sandbox.binDir, { recursive: true });
      mkdirSync(sandbox.configDir, { recursive: true });
      const previousPath = join(sandbox.dataDir, "versions", "1.0.0", "kunai.exe");
      const launcher = join(sandbox.binDir, "kunai.exe");
      writeFileSync(previousPath, "MZ-previous");
      writeFileSync(launcher, "MZ-previous");
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
            const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "2.0.0"], {
              ...sandbox.env,
              KUNAI_DL_BASE: baseUrl,
            });
            expect(result.status).not.toBe(0);
            expect(readFileSync(launcher, "utf8")).toBe("MZ-previous");
            expect(readFileSync(manifestPath, "utf8")).toBe(oldManifest);
            expect(existsSync(join(sandbox.dataDir, "locks", "activation.lock"))).toBe(false);
          },
        );
      } finally {
        chmodSync(sandbox.configDir, 0o755);
        sandbox.cleanup();
      }
    },
  );
});

const describeWindows = process.platform === "win32" && pwshAvailable() ? describe : describe.skip;

describeWindows("install.ps1 PATH diagnostics", () => {
  test("reports a stale npm shim as the PATH winner without removing it", async () => {
    const asset = hostWindowsAsset();
    const body = "MZ-fixture-payload";
    const digest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-stale-npm");
    const npmBinDir = join(sandbox.root, "npm");
    const npmShimPath = join(npmBinDir, "kunai.cmd");
    const nativePath = join(sandbox.binDir, "kunai.exe");
    mkdirSync(npmBinDir);
    installCommandShim(npmBinDir, "kunai");

    const env = withCommandPath(sandbox.env, npmBinDir);

    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${asset}`]: { body },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${digest}  ${asset}\n`,
          },
        },
        async (baseUrl) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...env,
            KUNAI_DL_BASE: baseUrl,
          });

          expect(result.status).toBe(0);
          expect(existsSync(npmShimPath)).toBe(true);
          // GitHub's Windows runner exposes the temp root as RUNNER~1 while
          // .NET's directory enumeration expands it to runneradmin. Both name
          // the same file, so compare against the canonical on-disk spelling.
          expect(result.stdout).toContain(`PATH winner: ${realpathSync.native(npmShimPath)}`);
          expect(result.stdout).toContain(`Planned native path: ${nativePath}`);
          expect(result.stdout).toContain("npm uninstall -g @kitsunekode/kunai");
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });
});

describePwsh("install.ps1 package activeVersion", () => {
  test("fails on npm exit 17 without printing Done or writing a manifest", () => {
    const sandbox = createInstallerSandbox("install-ps1-npm-failure");
    try {
      const shimDir = join(sandbox.root, "shims");
      mkdirSync(shimDir, { recursive: true });
      installCommandShim(shimDir, "node");
      installPwshCommandShim(shimDir, "npm", {
        unix: "#!/bin/sh\nexit 17\n",
        windows: "@echo off\r\nexit /b 17\r\n",
      });

      const result = runInstallPs1(
        ["-Method", "npm", "-Yes", "-Version", "4.5.6"],
        withCommandPath(sandbox.env, shimDir),
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stderr}${result.stdout}`).toContain("exit code 17");
      expect(result.stdout).not.toMatch(/^Done\.$/m);
      expect(existsSync(join(sandbox.configDir, "install.json"))).toBe(false);
      expect(existsSync(join(sandbox.dataDir, "locks", "activation.lock"))).toBe(false);
    } finally {
      sandbox.cleanup();
    }
  });

  test("npm method ignores a stale PATH kunai and records npm-owned metadata", () => {
    const sandbox = createInstallerSandbox("install-ps1-npm-version");
    try {
      const shimDir = join(sandbox.root, "shims");
      const npmRoot = join(sandbox.root, "npm-root");
      const npmPrefix = join(sandbox.root, "npm-prefix");
      mkdirSync(shimDir, { recursive: true });
      mkdirSync(npmPrefix, { recursive: true });
      mkdirSync(join(npmRoot, "@kitsunekode", "kunai"), { recursive: true });
      writeFileSync(
        join(npmRoot, "@kitsunekode", "kunai", "package.json"),
        JSON.stringify({ name: "@kitsunekode/kunai", version: "4.5.6" }),
      );
      installCommandShim(shimDir, "node");
      installPwshCommandShim(shimDir, "npm", {
        unix:
          '#!/bin/sh\nif [ "$1" = "root" ]; then printf "%s\\n" "$KUNAI_NPM_ROOT"; ' +
          'elif [ "$1" = "prefix" ]; then printf "%s\\n" "$KUNAI_NPM_PREFIX"; fi\nexit 0\n',
        windows:
          '@echo off\r\nif "%1"=="root" echo %KUNAI_NPM_ROOT%\r\n' +
          'if "%1"=="prefix" echo %KUNAI_NPM_PREFIX%\r\nexit /b 0\r\n',
      });
      installPwshCommandShim(shimDir, "kunai", {
        unix: '#!/bin/sh\necho "kunai 1.0.0 (stale-path-winner)"\n',
        windows: "@echo off\r\necho kunai 1.0.0 (stale-path-winner)\r\n",
      });

      const env = withCommandPath(sandbox.env, shimDir);
      env.KUNAI_NPM_ROOT = npmRoot;
      env.KUNAI_NPM_PREFIX = npmPrefix;

      const result = runInstallPs1(["-Method", "npm", "-Yes"], env);
      expect(result.status).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
      ) as { activeVersion: string; method: string; launcherPath: string };
      expect(manifest.method).toBe("npm-global");
      expect(manifest.activeVersion).toBe("4.5.6");
      expect(manifest.activeVersion).not.toBe("latest");
      // An absolute npm-owned shim path, never the bare command name.
      expect(manifest.launcherPath).toBe(join(npmPrefix, "kunai.cmd"));
    } finally {
      sandbox.cleanup();
    }
  });

  test.each(["npm", "bun"] as const)(
    "%s method pins explicit argv and records the observed matching version",
    (method) => {
      const sandbox = createInstallerSandbox(`install-ps1-${method}-explicit`);
      try {
        const shimDir = join(sandbox.root, "shims");
        const argvLog = join(sandbox.root, `${method}-argv.txt`);
        const npmRoot = join(sandbox.root, "npm-root");
        const npmPrefix = join(sandbox.root, "npm-prefix");
        const bunRoot = join(sandbox.root, "bun-root");
        mkdirSync(shimDir, { recursive: true });
        mkdirSync(npmPrefix, { recursive: true });
        if (method === "npm") {
          installCommandShim(shimDir, "node");
          mkdirSync(join(npmRoot, "@kitsunekode", "kunai"), { recursive: true });
          writeFileSync(
            join(npmRoot, "@kitsunekode", "kunai", "package.json"),
            JSON.stringify({ name: "@kitsunekode/kunai", version: "4.5.6" }),
          );
          installPwshCommandShim(shimDir, "npm", {
            unix:
              '#!/bin/sh\nif [ "$1" = "root" ]; then printf "%s\\n" "$KUNAI_NPM_ROOT"; ' +
              'elif [ "$1" = "prefix" ]; then printf "%s\\n" "$KUNAI_NPM_PREFIX"; ' +
              'else printf "%s\\n" "$*" > "$KUNAI_ARGV_LOG"; fi\nexit 0\n',
            windows:
              '@echo off\r\nif "%1"=="root" (echo %KUNAI_NPM_ROOT%) ' +
              'else if "%1"=="prefix" (echo %KUNAI_NPM_PREFIX%) ' +
              'else (echo %* > "%KUNAI_ARGV_LOG%")\r\nexit /b 0\r\n',
          });
        } else {
          mkdirSync(join(bunRoot, "install", "global", "node_modules", "@kitsunekode", "kunai"), {
            recursive: true,
          });
          writeFileSync(
            join(
              bunRoot,
              "install",
              "global",
              "node_modules",
              "@kitsunekode",
              "kunai",
              "package.json",
            ),
            JSON.stringify({ name: "@kitsunekode/kunai", version: "4.5.6" }),
          );
          installPwshCommandShim(shimDir, "bun", {
            unix: '#!/bin/sh\nprintf "%s\\n" "$*" > "$KUNAI_ARGV_LOG"\nexit 0\n',
            windows: '@echo off\r\necho %* > "%KUNAI_ARGV_LOG%"\r\nexit /b 0\r\n',
          });
        }

        const env = withCommandPath(
          {
            ...sandbox.env,
            KUNAI_ARGV_LOG: argvLog,
            KUNAI_NPM_ROOT: npmRoot,
            KUNAI_NPM_PREFIX: npmPrefix,
            BUN_INSTALL: bunRoot,
            // BUN_INSTALL_BIN outranks BUN_INSTALL by design (matching
            // install.sh and run-install.ts), so an ambient value — the Bun
            // Docker images set it to /usr/local/bin — would silently win over
            // this sandbox. Clear it so the precedence chain is what we assert.
            BUN_INSTALL_BIN: undefined,
          },
          shimDir,
        );

        const result = runInstallPs1(["-Method", method, "-Yes", "-Version", "4.5.6"], env);
        expect(result.status).toBe(0);
        expect(readFileSync(argvLog, "utf8").trim()).toBe(`install -g @kitsunekode/kunai@4.5.6`);
        const manifest = JSON.parse(
          readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
        ) as { activeVersion: string; launcherPath: string };
        expect(manifest.activeVersion).toBe("4.5.6");
        // Each channel records its own owner's absolute launcher, not "kunai".
        expect(manifest.launcherPath).toBe(
          method === "npm" ? join(npmPrefix, "kunai.cmd") : join(bunRoot, "bin", "kunai.exe"),
        );
      } finally {
        sandbox.cleanup();
      }
    },
  );
});

/**
 * `Confirm-OptionalInstall` gates winget/scoop package installs, so what it
 * does with no console is a privilege decision, not a UX one — the same
 * decision `ask()` makes in install.sh, where answering "yes" for an absent
 * human is how `curl … | bash` in CI ran `sudo apt-get install` unattended.
 *
 * The bash half is pinned in install-scripts.test.ts. This is the half that
 * only CI can run, and it is the half that had no coverage at all: this
 * machine has no pwsh, so a mistake here is invisible until Windows CI.
 */
describePwsh("install.ps1 consent without a console", () => {
  function runConfirm(options: { readonly yes?: boolean; readonly dryRun?: boolean } = {}): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    const source = readFileSync(INSTALL_PS1, "utf8");
    const fn = /^function Confirm-OptionalInstall \{[\s\S]*?^\}$/m.exec(source)?.[0];
    if (!fn) throw new Error("could not extract Confirm-OptionalInstall from install.ps1");

    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$Yes = $${options.yes === true}`,
      `$DryRun = $${options.dryRun === true}`,
      'function Write-Warn($m) { Write-Host "! $m" }',
      fn,
      // Piping into pwsh is what makes IsInputRedirected true — the same shape
      // as `irm … | iex` inside a CI step with no attached console.
      "if (Confirm-OptionalInstall 'Install mpv?') { 'CONSENTED' } else { 'DECLINED' }",
    ].join("\n");

    // `-File` against a real file, never `-Command -` with piped input: reading
    // a script from stdin puts pwsh in a mode that emits terminal escape
    // sequences (`ESC[?1h`) and swallows the output entirely, so every
    // assertion here saw escape codes rather than DECLINED/CONSENTED.
    const scriptPath = join(
      mkdtempSync(join(tmpdir(), "kunai-pwsh-consent-")),
      "confirm-optional-install.ps1",
    );
    writeFileSync(scriptPath, script);

    // stdin from a closed handle so `IsInputRedirected` is true with no
    // console — the `irm … | iex` shape this function has to refuse.
    return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", scriptPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: DEFAULT_SHELL_ENV,
    });
  }

  test("declines rather than assuming yes, and names the skipped step", () => {
    const result = runConfirm();
    expect(result.stdout).toContain("DECLINED");
    expect(result.stdout).not.toContain("CONSENTED");
    // The warning has to say which step was skipped and how to accept, or the
    // user is left with a silently incomplete install.
    expect(result.stdout).toContain("Install mpv?");
    expect(result.stdout).toContain("-Yes");
  });

  test("an explicit -Yes is still consent", () => {
    expect(runConfirm({ yes: true }).stdout).toContain("CONSENTED");
  });

  test("-DryRun reports the intended action without requiring a console", () => {
    expect(runConfirm({ dryRun: true }).stdout).toContain("CONSENTED");
  });
});

if (!pwshAvailable()) {
  describe("install.ps1 (pwsh unavailable locally)", () => {
    test("skips PowerShell installer coverage — CI Windows/Ubuntu pwsh job required", () => {
      expect(pwshAvailable()).toBe(false);
    });
  });
}
