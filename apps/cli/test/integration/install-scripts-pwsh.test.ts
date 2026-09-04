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
import { basename, delimiter, dirname, join } from "node:path";

import type { InstallManifest } from "@/services/update/install-manifest";
import { verifyStoredVersion } from "@/services/update/native-installer/version-metadata";
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
const PWSH_PATH = Bun.which("pwsh") ?? "pwsh";

function readInstallerManifest(configDir: string): InstallManifest {
  return JSON.parse(readFileSync(join(configDir, "install.json"), "utf8"));
}

async function readInstallerVersionMetadata(dataDir: string, version: string) {
  const result = await verifyStoredVersion(
    { versionsDir: join(dataDir, "versions"), binaryFileName: "kunai.exe" },
    version,
  );
  if (result.status !== "verified") {
    throw new Error(`Installer wrote invalid ${version} metadata: ${result.detail}`);
  }
  return result.metadata;
}

function impossibleProcessStartId(): string {
  if (process.platform === "win32") return "windows-ticks:0";
  if (process.platform === "darwin") return "darwin-ps:impossible";
  return "linux-proc:0";
}

/**
 * A hang guard for real installer subprocesses, not a timing assertion. The
 * Bash harness failed a release gate on its shorter guard while two concurrent
 * installers were still downloading; only a genuinely stuck installer should
 * ever reach this.
 */
async function waitForPaths(paths: readonly string[]): Promise<void> {
  const deadline = Date.now() + 60_000;
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

/**
 * Keep the installer's own patience inside the test's.
 *
 * `install.ps1` defaults to a 300 second download budget, three attempts, and a
 * one-second backoff — fifteen times the 20 second budget `test:integration`
 * gives a whole test. So one transient hiccup on a slow runner has the
 * installer still waiting politely while the harness kills the test, and the
 * failure reads as "timed out after 20000ms" with nothing to act on. That is
 * what took the Windows job red on a commit whose diff was Markdown only.
 *
 * A few tests already set these by hand to exercise retry and timeout paths;
 * spreading the caller's env last keeps those overrides winning.
 */
const BOUNDED_DOWNLOAD_ENV = {
  KUNAI_DOWNLOAD_TOTAL_SECONDS: "8",
  KUNAI_DOWNLOAD_MAX_ATTEMPTS: "2",
  KUNAI_DOWNLOAD_RETRY_BASE_MS: "50",
} as const;

/** Async so Bun.serve can answer while the installer runs (spawnSync deadlocks the fixture). */
async function runInstallPs1Async(
  args: string[],
  env: NodeJS.ProcessEnv = DEFAULT_SHELL_ENV,
  cwd?: string,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["pwsh", "-NoProfile", "-File", INSTALL_PS1, ...args], {
    cwd,
    env: { ...BOUNDED_DOWNLOAD_ENV, ...env },
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

function rewriteZipLocalName(archive: Uint8Array, replacement: string): Uint8Array {
  const output = new Uint8Array(archive);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const localNameLength = view.getUint16(26, true);
  const name = new TextEncoder().encode(
    replacement.padEnd(localNameLength, "x").slice(0, localNameLength),
  );
  output.set(name, 30);
  return output;
}

function prefixZipArchive(archive: Uint8Array): Uint8Array {
  const source = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const centralOffset = 30 + source.getUint16(26, true) + source.getUint32(18, true);
  const output = new Uint8Array(archive.length + 1);
  output[0] = 0x0a;
  output.set(archive, 1);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  view.setUint32(centralOffset + 1 + 42, 1, true);
  view.setUint32(output.length - 22 + 16, centralOffset + 1, true);
  return output;
}

function appendZipTrailingData(archive: Uint8Array): Uint8Array {
  const output = new Uint8Array(archive.length + 1);
  output.set(archive);
  output[archive.length] = 0x0a;
  return output;
}

function invalidZipArchive(
  kind:
    | "absolute"
    | "case-variant"
    | "corrupt"
    | "crc"
    | "extra"
    | "local-traversal"
    | "missing"
    | "prefix"
    | "reparse"
    | "symlink"
    | "trailing"
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
  if (kind === "case-variant") {
    const view = new DataView(canonical.buffer, canonical.byteOffset, canonical.byteLength);
    const localNameLength = view.getUint16(26, true);
    const current = new TextDecoder().decode(canonical.subarray(30, 30 + localNameLength));
    return rewriteZipNames(canonical, current.toUpperCase());
  }
  if (kind === "local-traversal") return rewriteZipLocalName(canonical, "../evil.exe");
  if (kind === "prefix") return prefixZipArchive(canonical);
  if (kind === "trailing") return appendZipTrailingData(canonical);
  if (kind === "traversal") return rewriteZipNames(canonical, "../kunai.exe");
  if (kind === "wrong") return rewriteZipNames(canonical, "wrong.exe");
  const output = new Uint8Array(canonical);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const centralOffset = 30 + view.getUint16(26, true) + view.getUint32(18, true);
  if (kind === "crc") {
    const invalidCrc = (view.getUint32(14, true) ^ 1) >>> 0;
    view.setUint32(14, invalidCrc, true);
    view.setUint32(centralOffset + 16, invalidCrc, true);
    return output;
  }
  if (kind === "extra") {
    view.setUint16(output.length - 14, 2, true);
    view.setUint16(output.length - 12, 2, true);
    return output;
  }
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
    expect(result.stdout).toContain(
      "Skipping optional dependencies (mpv, yt-dlp, curl-impersonate).",
    );
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
      //
      // The PATH is the shim directory ALONE. `withCommandPath` prepends to the
      // inherited PATH, which leaves the developer's real mpv and yt-dlp
      // visible -- and the installer now checks before it offers, so on such a
      // machine there is correctly nothing to plan and this test saw only the
      // curl branch. Isolating the PATH is what makes "missing" true here.
      // pwsh still has to be resolvable, so its own directory stays -- but
      // nothing else does, which is what keeps a developer's real mpv out of
      // the run.
      const pwshDir = dirname(
        spawnSync("pwsh", ["-NoProfile", "-Command", "(Get-Process -Id $PID).Path"], {
          encoding: "utf8",
        }).stdout.trim(),
      );
      const shimOnlyEnv: NodeJS.ProcessEnv = { ...sandbox.env };
      for (const key of Object.keys(shimOnlyEnv)) {
        if (key.toLowerCase() === "path") delete shimOnlyEnv[key];
      }
      shimOnlyEnv[process.platform === "win32" ? "Path" : "PATH"] = [sandbox.root, pwshDir].join(
        delimiter,
      );

      const result = runInstallPs1(["-DryRun", "-Yes", "-Version", "9.8.7"], shimOnlyEnv);

      expect(result.status).toBe(0);
      // mpv.net ships mpvnet.exe; Kunai probes for `mpv`. See the winget id note
      // in install.ps1 — this asserts the installer stays on real mpv.
      expect(result.stdout).toContain("winget install --id mpv-player.mpv-CI.MSVC -e");
      expect(result.stdout).not.toContain("mpv.net");
      if (process.platform === "win32") {
        // Windows one-click path: portable GitHub binaries, not the ambiguous
        // `winget install yt-dlp` that matches a Microsoft Store listing.
        expect(result.stdout).toContain("yt-dlp.exe");
        expect(result.stdout).toContain("curl-impersonate");
        expect(result.stdout).not.toMatch(/winget install yt-dlp(?:\s|$)/);
      } else {
        // Linux pwsh harness: $OnWindows is false, so the winget fallback is
        // what the dry-run prints. The id must still be exact.
        expect(result.stdout).toContain("winget install --id yt-dlp.yt-dlp -e");
      }
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
  /**
   * Runs a real install.ps1 that downloads a zip, verifies two digests and
   * expands the archive. On a Windows runner that is PowerShell start-up plus
   * Expand-Archive plus disk, none of which this test is asserting anything
   * about — it asserts the archive path completes and records provenance. The
   * shared 20s integration budget was close enough to that cost to fail a green
   * release gate at 20000.70ms, so this one gets a guard sized to catch a stuck
   * installer instead of a slow one.
   */
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
          const manifest = readInstallerManifest(sandbox.configDir);
          expect(manifest).toMatchObject({
            schemaVersion: 2,
            artifactName: target.out,
            artifactSha256: binaryDigest,
            artifactSizeBytes: Buffer.byteLength(body),
            artifactSourceUrl: `${baseUrl}/download/v9.8.7/${target.out}`,
            archiveName: target.archiveName,
            archiveSha256: archiveDigest,
            archiveSizeBytes: archive.length,
            archiveSourceUrl: `${baseUrl}/download/v9.8.7/${target.archiveName}`,
          });
          const metadata = await readInstallerVersionMetadata(sandbox.dataDir, "9.8.7");
          expect(metadata).toMatchObject({
            artifactName: target.out,
            artifactSha256: binaryDigest,
            sizeBytes: Buffer.byteLength(body),
            sourceUrl: `${baseUrl}/download/v9.8.7/${target.out}`,
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
  }, 120_000);

  test.each([
    "absolute",
    "case-variant",
    "corrupt",
    "crc",
    "extra",
    "local-traversal",
    "missing",
    "prefix",
    "reparse",
    "symlink",
    "trailing",
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
          if (kind === "crc") expect(result.stderr).toMatch(/CRC/i);
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

  test("rejects a case-variant checksum asset identity", async () => {
    const target = hostWindowsTarget();
    const body = "MZ-case-sensitive-checksum-name";
    const archive = createReleaseArchive(target, new TextEncoder().encode(body));
    const archiveDigest = createHash("sha256").update(archive).digest("hex");
    const binaryDigest = createHash("sha256").update(body).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-checksum-case-variant");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${target.archiveName}`]: { body: archive },
          "/download/v9.8.7/SHA256SUMS.archives": {
            body: `${archiveDigest}  ${target.archiveName.toUpperCase()}\n`,
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

          expect(result.status).not.toBe(0);
          expect(evidence.requests).not.toContain(`/download/v9.8.7/${target.out}`);
          expect(existsSync(join(sandbox.binDir, "kunai.exe"))).toBe(false);
          expect(existsSync(join(sandbox.configDir, "install.json"))).toBe(false);
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

  test("rejects extracted binary checksum mismatch without raw fallback or residue", async () => {
    const target = hostWindowsTarget();
    const body = "MZ-archive-member";
    const archive = createReleaseArchive(target, new TextEncoder().encode(body));
    const archiveDigest = createHash("sha256").update(archive).digest("hex");
    const sandbox = createInstallerSandbox("install-ps1-extracted-mismatch");
    try {
      await withReleaseFixture(
        {
          [`/download/v9.8.7/${target.archiveName}`]: { body: archive },
          "/download/v9.8.7/SHA256SUMS.archives": {
            body: `${archiveDigest}  ${target.archiveName}\n`,
          },
          "/download/v9.8.7/SHA256SUMS": {
            body: `${"0".repeat(64)}  ${target.out}\n`,
          },
          [`/download/v9.8.7/${target.out}`]: { body: "LEGACY-RAW-MUST-NOT-RUN" },
        },
        async (baseUrl, evidence) => {
          const result = await runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", "9.8.7"], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
          });

          expect(result.status).not.toBe(0);
          expect(`${result.stderr}${result.stdout}`).toContain(
            `Checksum mismatch for extracted ${target.out}`,
          );
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

          const metadata = await readInstallerVersionMetadata(sandbox.dataDir, "9.8.7");
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

          const manifest = readInstallerManifest(sandbox.configDir);
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
          const versionMetadata = await readInstallerVersionMetadata(sandbox.dataDir, "9.8.7");
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
        // See the Bash harness: the first installer to finish downloading holds
        // for the lock while its sibling downloads, and that gap must not
        // exhaust the installer's own lock timeout on a slow runner.
        const installs = versions.map((version) =>
          runInstallPs1Async(["-Yes", "-SkipDeps", "-Version", version], {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_ACTIVATION_LOCK_TIMEOUT_MS: "60000",
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

        const manifest = readInstallerManifest(sandbox.configDir);
        expect(new Set<string>(versions).has(manifest.activeVersion)).toBe(true);
        if (!manifest.versionedPath) throw new Error("Binary manifest omitted versionedPath");
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
          expect(result.stdout).toContain("Another kunai comes earlier on your PATH");
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
      const manifest = readInstallerManifest(sandbox.configDir);
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
        const manifest = readInstallerManifest(sandbox.configDir);
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

if (!pwshAvailable()) {
  describe("install.ps1 (pwsh unavailable locally)", () => {
    test("skips PowerShell installer coverage — CI Windows/Ubuntu pwsh job required", () => {
      expect(pwshAvailable()).toBe(false);
    });
  });
}

/**
 * Windows parity for the optional-dependency consent rules. install.ps1 had the
 * same shape as the bash flow: a prompt defaulting to yes, `-Yes` treated as
 * consent for everything, and `--accept-package-agreements
 * --accept-source-agreements` accepting a third party's licence terms on the
 * user's behalf.
 */
describePwsh("install.ps1 optional dependency consent", () => {
  function evalInstallPs1(body: string, testCmd: string): string {
    const script = [
      `$src = Get-Content -Raw ${JSON.stringify(INSTALL_PS1)}`,
      'function Write-Info { param($m) Write-Host "> $m" }',
      'function Write-Warn { param($m) Write-Host "! $m" }',
      'function Invoke-OptionalStep { param($d,$a) Write-Host "[RAN] $d" }',
      testCmd,
      "foreach ($fn in 'Get-PackageInstallCommand','Request-OptionalInstall') {",
      '  Invoke-Expression ([regex]::Match($src, "(?ms)^function $fn \\{.*?^\\}").Value)',
      "}",
      body,
    ].join("\n");
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    expect(result.stderr, result.stderr).not.toContain("ParserError");
    return `${result.stdout}${result.stderr}`;
  }

  /**
   * One pwsh process for the whole mapping table. Five separate spawns were
   * flaky under a loaded suite -- pwsh start-up dominates, and a starved one
   * returned empty output -- and the table is what is being asserted, not the
   * process boundary.
   */
  test("each Windows package manager maps to its own install command", () => {
    const probe = [
      "foreach ($mgr in 'winget','scoop','choco') {",
      "  Invoke-Expression \"function Test-Cmd { param(`$n) return `$n -eq '$mgr' }\"",
      "  foreach ($pkg in 'mpv','yt-dlp','curl') {",
      '    Write-Output "$mgr|$pkg|$(Get-PackageInstallCommand $pkg)"',
      "  }",
      "}",
      "function Test-Cmd { param($n) return $false }",
      "Write-Output \"none|mpv|$(Get-PackageInstallCommand 'mpv')\"",
    ].join("\n");

    const rows = evalInstallPs1(probe, "function Test-Cmd { param($n) return $false }")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("|"));
    const table = Object.fromEntries(
      rows.map((row) => {
        const [manager, pkg, ...rest] = row.split("|");
        return [`${manager}/${pkg}`, rest.join("|")];
      }),
    );

    // The winget ids are load-bearing: mpv.net ships mpvnet.exe, which Kunai
    // cannot drive over mpv's IPC socket.
    expect(table["winget/mpv"]).toBe("winget install --id mpv-player.mpv-CI.MSVC -e");
    expect(table["winget/curl"]).toBe("winget install --id cURL.cURL -e");
    expect(table["winget/yt-dlp"]).toBe("winget install --id yt-dlp.yt-dlp -e");
    expect(table["scoop/mpv"]).toBe("scoop install mpv");
    expect(table["choco/mpv"]).toBe("choco install mpv");
    // No recognised manager must yield no command, so the caller falls through
    // to the manual guidance rather than inventing one.
    expect(table["none/mpv"]).toBe("");
  });

  test("no command auto-accepts a package or source agreement", () => {
    for (const pkg of ["mpv", "yt-dlp", "curl"]) {
      const command = evalInstallPs1(
        `Get-PackageInstallCommand ${JSON.stringify(pkg)}`,
        "function Test-Cmd { param($n) return $n -eq 'winget' }",
      );
      expect(command).not.toContain("--accept-package-agreements");
      expect(command).not.toContain("--accept-source-agreements");
    }
    // Chocolatey used to ship `choco install … -y`, which is the same
    // unattended-confirm shape the winget --accept flags had.
    for (const pkg of ["mpv", "yt-dlp", "curl"]) {
      const command = evalInstallPs1(
        `Get-PackageInstallCommand ${JSON.stringify(pkg)}`,
        "function Test-Cmd { param($n) return $n -eq 'choco' }",
      );
      expect(command.trim()).toBe(`choco install ${pkg}`);
      expect(command).not.toMatch(/(^|\s)-y(\s|$)/);
    }
  });

  test("-Yes prints the command instead of installing", () => {
    const output = evalInstallPs1(
      "$Yes = $true; $DryRun = $false; Request-OptionalInstall @('mpv','yt-dlp')",
      "function Test-Cmd { param($n) return $n -eq 'winget' }",
    );
    // -Yes is consent to install Kunai, not to accept a third party's terms.
    expect(output).not.toContain("[RAN]");
    expect(output).toContain("winget install --id mpv-player.mpv-CI.MSVC -e");
    expect(output).toContain("winget install --id yt-dlp.yt-dlp -e");
    expect(output).not.toMatch(/winget install yt-dlp(?:\s|$)/);
  });

  /**
   * The no-console case is a privilege decision, not a UX one: answering "yes"
   * for an absent human is how `irm … | iex` in CI used to acquire system
   * packages unattended. Redirected input takes the same path as `-Yes` —
   * report what is missing, never install it.
   */
  /**
   * curl-impersonate is not a substitute for an HTTP/2 `curl.exe`, and the
   * installer must not treat it as one.
   *
   * They are different binaries: the release archive ships
   * `curl-impersonate.exe` plus `curl_*.bat` wrappers and no `curl.exe` at all,
   * and only the provider clients resolve those, through `resolveCurlCandidate`.
   * The HLS relay (`apps/cli/src/infra/player/hls-relay.ts`) spawns the literal
   * `curl` from PATH. Skipping this prompt whenever an impersonate build was
   * found hid the one remedy for that, on precisely the hosts that need it —
   * every stock Windows box, since the System32 build is Schannel with no
   * nghttp2.
   */
  test("still offers the HTTP/2 curl upgrade after curl-impersonate installs", () => {
    const script = [
      `$src = Get-Content -Raw ${JSON.stringify(INSTALL_PS1)}`,
      'function Write-Info { param($m) Write-Host "> $m" }',
      'function Write-Warn { param($m) Write-Host "! $m" }',
      "$OnWindows = $true",
      "$SkipDeps = $false",
      // Everything the impersonate path can report as success, at once: it was
      // just installed *and* it is discoverable on PATH.
      "function Install-PortableYtDlp { return $true }",
      "function Install-PortableCurlImpersonate { return $true }",
      "function Test-CurlImpersonatePresent { return $true }",
      // mpv and yt-dlp present; curl present but not answering --version, which
      // is the same branch the Schannel build reaches by reporting no HTTP2.
      "function Test-Cmd { param($n) return $true }",
      "function Request-OptionalInstall { param($m) Write-Host \"[ASKED] $($m -join ',')\" }",
      'Invoke-Expression ([regex]::Match($src, "(?ms)^function Install-OptionalDeps \\{.*?^\\}").Value)',
      "Install-OptionalDeps",
    ].join("\n");
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    expect(result.stderr, result.stderr).not.toContain("ParserError");
    const output = `${result.stdout}${result.stderr}`;

    expect(output).toContain("The curl on PATH has no HTTP/2 support");
    expect(output).toContain("[ASKED] curl");
    // And it says why, so the prompt does not read as the installer forgetting
    // the curl-impersonate it dropped two lines earlier.
    expect(output).toContain("curl-impersonate covers Cloudflare, not HTTP/2");
    // yt-dlp was handled by the portable helper, so it must not also be asked for.
    expect(output).not.toContain("yt-dlp is not installed");
  });

  test("no console reports the command instead of installing", () => {
    const output = evalInstallPs1(
      "$Yes = $false; $DryRun = $false; Request-OptionalInstall @('mpv')",
      "function Test-Cmd { param($n) return $n -eq 'winget' }",
    );
    expect(output).not.toContain("[RAN]");
    expect(output).toContain("winget install --id mpv-player.mpv-CI.MSVC -e");
  });

  test("an unrecognised host still gets manual guidance", () => {
    const output = evalInstallPs1(
      "$Yes = $false; $DryRun = $false; Request-OptionalInstall @('mpv')",
      "function Test-Cmd { param($n) return $false }",
    );
    expect(output).toContain("No supported package manager found");
    expect(output).toContain("https://mpv.io/installation/");
    expect(output).not.toContain("[RAN]");
  });
});

/**
 * Both PowerShell parameter spellings: a `param()` block inside the body, and
 * the inline `function Name([string]$Dir) {` form the smaller helpers use.
 */
function extractPs1Function(source: string, name: string): string {
  const match = new RegExp(`^function ${name}(?:\\([^)]*\\))? \\{[\\s\\S]*?^\\}`, "m").exec(source);
  if (!match) throw new Error(`could not extract function ${name} from install.ps1`);
  return match[0];
}

/**
 * Script-scope constants the extracted functions close over. Lifted from
 * install.ps1 for the same reason the functions are: a probe that restates the
 * value tests its own copy, and the shipped one is free to drift.
 */
function extractPs1Assignment(source: string, name: string): string {
  const match = new RegExp(`^\\$${name} = .*$`, "m").exec(source);
  if (!match) throw new Error(`could not extract $${name} from install.ps1`);
  return match[0];
}

function commandSourceDir(command: string): string {
  const result = spawnSync(
    "pwsh",
    ["-NoProfile", "-Command", `(Get-Command ${command} -ErrorAction Stop).Source`],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`${command} not found: ${result.stderr || result.stdout}`);
  }
  return dirname(result.stdout.trim());
}

/**
 * PATH is the shim directory plus pwsh and tar, nothing else. A developer
 * machine with yt-dlp already installed would otherwise skip the portable
 * download the way production does, and this suite would never hit GitHub.
 */
function isolatedHelperEnv(sandbox: ReturnType<typeof createInstallerSandbox>): NodeJS.ProcessEnv {
  installCommandShim(sandbox.root, "winget");
  const env: NodeJS.ProcessEnv = { ...sandbox.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  env[pathKey] = [sandbox.root, commandSourceDir("pwsh"), commandSourceDir("tar")].join(delimiter);
  return env;
}

/** Same `./curl_chrome*.bat` layout the v2.2.1 Windows tarball actually ships. */
function createCurlImpersonateArchive(workDir: string): {
  bytes: Uint8Array;
  sha256: string;
  asset: string;
} {
  const payloadDir = join(workDir, "curl-payload");
  mkdirSync(payloadDir, { recursive: true });
  writeFileSync(join(payloadDir, "curl_chrome146.bat"), "@echo off\r\nrem fixture\r\n");
  writeFileSync(join(payloadDir, "curl-impersonate.exe"), "MZ-curl-impersonate-fixture\n");
  const asset = "curl-impersonate-v2.2.1.x86_64-win32.tar.gz";
  const archivePath = join(workDir, asset);
  const packed = spawnSync("tar", ["-czf", archivePath, "-C", payloadDir, "."], {
    encoding: "utf8",
  });
  if (packed.status !== 0) {
    throw new Error(`tar -czf failed: ${packed.stderr || packed.stdout}`);
  }
  const bytes = new Uint8Array(readFileSync(archivePath));
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), asset };
}

/**
 * Extract the portable-helper installers and the download stack they call, then
 * run them against a local fixture. Must be async: spawnSync deadlocks
 * Bun.serve the same way the binary-install fixtures do.
 */
async function runPortableHelperProbe(
  env: NodeJS.ProcessEnv,
  body: string,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const source = readFileSync(INSTALL_PS1, "utf8");
  const functions = [
    "Format-ByteSize",
    "Write-DownloadProgress",
    "Clear-DownloadProgress",
    "Invoke-BoundedDownload",
    "Write-Utf8File",
    "Get-YtdlpReleaseAsset",
    "Get-HelperChecksumEntry",
    "Test-ManagedFileDigest",
    "Test-ManagedSourceDigest",
    "Get-CurlImpersonateWindowsSpec",
    "Test-CurlImpersonatePresent",
    "Find-CurlImpersonateWrapperDir",
    "Get-PackageInstallCommand",
    "Register-HelperPath",
    "Install-PortableYtDlp",
    "Install-PortableCurlImpersonate",
  ].map((name) => extractPs1Function(source, name));

  const dataDir = env.KUNAI_DATA_DIR;
  if (!dataDir) throw new Error("KUNAI_DATA_DIR required for portable helper probe");
  mkdirSync(dataDir, { recursive: true });
  const probePath = join(dataDir, "portable-helper-probe.ps1");
  writeFileSync(
    probePath,
    [
      "Add-Type -AssemblyName System.Net.Http",
      "$ErrorActionPreference = 'Stop'",
      "$OnWindows = if ($null -eq $IsWindows) { $true } else { $IsWindows }",
      "$DryRun = $false",
      "$SkipPathUpdate = $true",
      "$Yes = $true",
      "$DataDir = $env:KUNAI_DATA_DIR",
      "$CacheDir = $env:KUNAI_CACHE_DIR",
      "$YtdlpReleaseBase = $env:KUNAI_YTDLP_RELEASE_BASE.TrimEnd('/')",
      "$CurlImpersonateVersion = if ($env:KUNAI_CURL_IMPERSONATE_VERSION) { $env:KUNAI_CURL_IMPERSONATE_VERSION } else { 'v2.2.1' }",
      "$CurlImpersonateWin64Digest = if ($env:KUNAI_CURL_IMPERSONATE_SHA256) { $env:KUNAI_CURL_IMPERSONATE_SHA256.ToLowerInvariant() } else { 'f7faa8c42b63b4a96245429e46956e11ae7d7076d60f65768c0018d3bb18d7e5' }",
      "$DownloadConnectTimeoutSec = if ($env:KUNAI_DOWNLOAD_CONNECT_TIMEOUT) { [int]$env:KUNAI_DOWNLOAD_CONNECT_TIMEOUT } else { 15 }",
      "$DownloadTotalSeconds = if ($env:KUNAI_DOWNLOAD_TOTAL_SECONDS) { [int]$env:KUNAI_DOWNLOAD_TOTAL_SECONDS } else { 8 }",
      "$DownloadStallMs = if ($env:KUNAI_DOWNLOAD_STALL_MS) { [int]$env:KUNAI_DOWNLOAD_STALL_MS } else { 30000 }",
      "$DownloadMaxBytes = if ($env:KUNAI_DOWNLOAD_MAX_BYTES) { [long]$env:KUNAI_DOWNLOAD_MAX_BYTES } else { 268435456 }",
      "$DownloadArchiveMaxBytes = if ($env:KUNAI_DOWNLOAD_ARCHIVE_MAX_BYTES) { [long]$env:KUNAI_DOWNLOAD_ARCHIVE_MAX_BYTES } else { 67108864 }",
      "$DownloadChecksumMaxBytes = if ($env:KUNAI_DOWNLOAD_CHECKSUM_MAX_BYTES) { [long]$env:KUNAI_DOWNLOAD_CHECKSUM_MAX_BYTES } else { 1048576 }",
      "$DownloadMaxAttempts = if ($env:KUNAI_DOWNLOAD_MAX_ATTEMPTS) { [int]$env:KUNAI_DOWNLOAD_MAX_ATTEMPTS } else { 2 }",
      "$DownloadProgressMinBytes = if ($env:KUNAI_DOWNLOAD_PROGRESS_MIN_BYTES) { [long]$env:KUNAI_DOWNLOAD_PROGRESS_MIN_BYTES } else { 1048576 }",
      "$DownloadRetryBaseMs = if ($env:KUNAI_DOWNLOAD_RETRY_BASE_MS) { [int]$env:KUNAI_DOWNLOAD_RETRY_BASE_MS } else { 50 }",
      "$script:LastDownloadHttpStatus = $null",
      'function Write-Info($m) { Write-Host "-> $m" }',
      'function Write-Warn($m) { Write-Host "! $m" }',
      // The fixture owns yt-dlp state. Never let a host installation turn a
      // download/repair assertion into an accidental already-present branch.
      "function Test-Cmd($name) { if ($name -eq 'yt-dlp') { return $false }; [bool](Get-Command $name -ErrorAction SilentlyContinue) }",
      "function Test-RetryableHttpStatus([int]$Status) { return ($Status -eq 408 -or $Status -eq 429 -or $Status -ge 500) }",
      "function Get-WindowsArch { return 'x64' }",
      // Stands in for the -SkipPathUpdate branch of the real Add-UserPath: it
      // announces and returns without touching PATH, so the extracted
      // Register-HelperPath is the only thing writing $env:Path here.
      'function Add-UserPath([string]$Dir) { Write-Info "Skipping persistent User PATH update for $Dir." }',
      extractPs1Assignment(source, "CurlImpersonateWrapperPattern"),
      ...functions,
      body,
    ].join("\n"),
  );

  const proc = Bun.spawn([PWSH_PATH, "-NoProfile", "-File", probePath], {
    env: { ...BOUNDED_DOWNLOAD_ENV, ...env },
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

/**
 * Portable Windows helpers: yt-dlp.exe and curl-impersonate are fetched from
 * GitHub into Kunai's data dir so `irm … | iex` does not depend on winget
 * confirming a third-party licence (and so curl-impersonate, which has no
 * Windows package, actually gets installed).
 */
describePwsh("install.ps1 portable Windows helpers", () => {
  function extractFn(name: string): string {
    return `Invoke-Expression ([regex]::Match($src, "(?ms)^function ${name} \\{.*?^\\}").Value)`;
  }

  function evalHelperFns(body: string): string {
    const script = [
      `$src = Get-Content -Raw ${JSON.stringify(INSTALL_PS1)}`,
      'function Write-Info { param($m) Write-Host "> $m" }',
      'function Write-Warn { param($m) Write-Host "! $m" }',
      "$CurlImpersonateVersion = 'v2.2.1'",
      "$CurlImpersonateWin64Digest = 'f7faa8c42b63b4a96245429e46956e11ae7d7076d60f65768c0018d3bb18d7e5'",
      // Read out of install.ps1, not restated: this is the rule under test in
      // the wrapper-family cases below.
      `Invoke-Expression ([regex]::Match($src, '(?m)^\\$CurlImpersonateWrapperPattern = .*$').Value)`,
      extractFn("Get-YtdlpReleaseAsset"),
      extractFn("Get-HelperChecksumEntry"),
      extractFn("Get-CurlImpersonateWindowsSpec"),
      extractFn("Test-CurlImpersonatePresent"),
      extractFn("Find-CurlImpersonateWrapperDir"),
      body,
    ].join("\n");
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
    });
    expect(result.stderr, result.stderr).not.toContain("ParserError");
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    return `${result.stdout}${result.stderr}`;
  }

  test("picks the official yt-dlp asset for x64 and arm64", () => {
    const output = evalHelperFns(
      [
        "Write-Output (Get-YtdlpReleaseAsset -Arch x64)",
        "Write-Output (Get-YtdlpReleaseAsset -Arch arm64)",
      ].join("; "),
    );
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(lines).toContain("yt-dlp.exe");
    expect(lines).toContain("yt-dlp_arm64.exe");
  });

  test("curl-impersonate Windows spec is x64-only and matches the CI pin", () => {
    const output = evalHelperFns(`
      $spec = Get-CurlImpersonateWindowsSpec -Arch x64
      Write-Output $spec.Version
      Write-Output $spec.Asset
      Write-Output $spec.Url
      Write-Output $spec.Sha256
      $arm = Get-CurlImpersonateWindowsSpec -Arch arm64
      if ($null -eq $arm) { Write-Output 'arm64-none' }
    `);
    expect(output).toContain("v2.2.1");
    expect(output).toContain("curl-impersonate-v2.2.1.x86_64-win32.tar.gz");
    expect(output).toContain(
      "https://github.com/lexiforest/curl-impersonate/releases/download/v2.2.1/curl-impersonate-v2.2.1.x86_64-win32.tar.gz",
    );
    expect(output).toContain("f7faa8c42b63b4a96245429e46956e11ae7d7076d60f65768c0018d3bb18d7e5");
    expect(output).toContain("arm64-none");
  });

  test("helper checksums accept GNU coreutils spacing and a binary-mode star", () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-ytdlp-sums-"));
    try {
      const sums = join(dir, "SHA2-256SUMS");
      const digest = "a".repeat(64);
      writeFileSync(sums, `${digest}  yt-dlp.exe\n${digest} *yt-dlp_arm64.exe\n`);
      const output = evalHelperFns(`
        Write-Output (Get-HelperChecksumEntry ${JSON.stringify(sums)} 'yt-dlp.exe')
        Write-Output (Get-HelperChecksumEntry ${JSON.stringify(sums)} 'yt-dlp_arm64.exe')
      `);
      const lines = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines.filter((line) => line === digest)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("discovers the .bat wrappers the Windows curl-impersonate release ships", () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-curl-impersonate-"));
    try {
      writeFileSync(join(dir, "curl_chrome150.bat"), "@echo off\r\n");
      writeFileSync(join(dir, "curl-impersonate.exe"), "MZ");
      const output = evalHelperFns(`
        $env:Path = ${JSON.stringify(dir)}
        if (Test-CurlImpersonatePresent) { Write-Output 'present' } else { Write-Output 'missing' }
        Write-Output (Find-CurlImpersonateWrapperDir ${JSON.stringify(dir)})
      `);
      expect(output).toContain("present");
      const reported = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && line !== "present");
      expect(reported, output).toBeDefined();
      // PowerShell's Directory.FullName and Node's mkdtemp do not share a
      // spelling. Windows GitHub runners expand RUNNER~1 to runneradmin;
      // macOS realpath rewrites /var to /private/var while pwsh keeps /var.
      // Compare the resolved inode, not the string the helper printed.
      expect(realpathSync.native(reported!)).toBe(realpathSync.native(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The installer's notion of "an impersonate build is already here" has to be
   * the resolver's, or the two disagree in both directions: a mobile-only
   * directory reads as done while `resolveCurlCandidate` falls back to plain
   * curl, and a firefox-only directory reads as empty and gets a redundant
   * download over a working install. `curl_chrome131_android.bat`,
   * `curl_safari260_ios.bat` and `curl_tor145.bat` all ship in the real v2.2.1
   * archive, and `parseWrapper` rejects every one of them.
   */
  test("counts only the desktop wrappers the provider resolver would select", () => {
    const cases = [
      { file: "curl_chrome146.bat", expected: "present" },
      { file: "curl_firefox147.bat", expected: "present" },
      { file: "curl_safari260.bat", expected: "present" },
      { file: "curl_edge101.bat", expected: "present" },
      { file: "curl_chrome133a.bat", expected: "present" },
      { file: "curl_chrome131_android.bat", expected: "missing" },
      { file: "curl_safari260_ios.bat", expected: "missing" },
      { file: "curl_tor145.bat", expected: "missing" },
    ] as const;

    for (const { file, expected } of cases) {
      const dir = mkdtempSync(join(tmpdir(), "kunai-wrapper-family-"));
      try {
        writeFileSync(join(dir, file), "@echo off\r\n");
        writeFileSync(join(dir, "curl-impersonate.exe"), "MZ\n");
        const output = evalHelperFns(`
          $env:Path = ${JSON.stringify(dir)}
          if (Test-CurlImpersonatePresent) { Write-Output 'present' } else { Write-Output 'missing' }
        `);
        expect(output, `${file} should read as ${expected}`).toContain(expected);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("plain curl.exe is not an impersonate build", () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-plain-curl-"));
    try {
      writeFileSync(join(dir, "curl.exe"), "MZ");
      const output = evalHelperFns(`
        $env:Path = ${JSON.stringify(dir)}
        if (Test-CurlImpersonatePresent) { Write-Output 'present' } else { Write-Output 'missing' }
      `);
      expect(output).toContain("missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("downloads verified yt-dlp.exe and extracts curl-impersonate wrappers into Kunai's data dir", async () => {
    const sandbox = createInstallerSandbox("install-ps1-portable-helpers");
    const ytdlpBody = "MZ-portable-yt-dlp-fixture\n";
    const ytdlpDigest = createHash("sha256").update(ytdlpBody).digest("hex");
    const archive = createCurlImpersonateArchive(sandbox.root);
    try {
      await withReleaseFixture(
        {
          "/SHA2-256SUMS": {
            body: `${ytdlpDigest}  yt-dlp.exe\n${"b".repeat(64)}  yt-dlp_arm64.exe\n`,
          },
          "/yt-dlp.exe": { body: ytdlpBody },
          [`/${archive.asset}`]: { body: archive.bytes },
        },
        async (baseUrl, evidence) => {
          const result = await runPortableHelperProbe(
            {
              ...isolatedHelperEnv(sandbox),
              KUNAI_YTDLP_RELEASE_BASE: baseUrl,
              KUNAI_CURL_IMPERSONATE_RELEASE_BASE: baseUrl,
              KUNAI_CURL_IMPERSONATE_VERSION: "v2.2.1",
              KUNAI_CURL_IMPERSONATE_SHA256: archive.sha256,
            },
            [
              "$ytdlp = [bool](Install-PortableYtDlp)",
              "$imp = [bool](Install-PortableCurlImpersonate)",
              'Write-Output "RESULT ytdlp=$ytdlp impersonate=$imp"',
            ].join("\n"),
          );
          expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
          expect(result.stdout).toContain("RESULT ytdlp=True impersonate=True");
          expect(result.stdout).toContain("Installed yt-dlp ->");
          expect(result.stdout).toContain("Installed curl-impersonate ->");
          expect(readFileSync(join(sandbox.dataDir, "deps", "yt-dlp", "yt-dlp.exe"), "utf8")).toBe(
            ytdlpBody,
          );
          expect(
            existsSync(join(sandbox.dataDir, "deps", "curl-impersonate", "curl_chrome146.bat")),
          ).toBe(true);
          expect(existsSync(join(sandbox.dataDir, "deps", "curl-impersonate", "extract"))).toBe(
            false,
          );
          expect(evidence.requests).toContain("/SHA2-256SUMS");
          expect(evidence.requests).toContain("/yt-dlp.exe");
          expect(evidence.requests).toContain(`/${archive.asset}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("checksum mismatch leaves no dest and prints the exact winget id plus the impersonate releases URL", async () => {
    const sandbox = createInstallerSandbox("install-ps1-portable-helpers-mismatch");
    const ytdlpBody = "MZ-portable-yt-dlp-bad-checksum\n";
    const archive = createCurlImpersonateArchive(sandbox.root);
    try {
      await withReleaseFixture(
        {
          "/SHA2-256SUMS": { body: `${"a".repeat(64)}  yt-dlp.exe\n` },
          "/yt-dlp.exe": { body: ytdlpBody },
          [`/${archive.asset}`]: { body: archive.bytes },
        },
        async (baseUrl) => {
          const result = await runPortableHelperProbe(
            {
              ...isolatedHelperEnv(sandbox),
              KUNAI_YTDLP_RELEASE_BASE: baseUrl,
              KUNAI_CURL_IMPERSONATE_RELEASE_BASE: baseUrl,
              KUNAI_CURL_IMPERSONATE_VERSION: "v2.2.1",
              KUNAI_CURL_IMPERSONATE_SHA256: "f".repeat(64),
            },
            [
              "$ytdlp = [bool](Install-PortableYtDlp)",
              "$imp = [bool](Install-PortableCurlImpersonate)",
              'Write-Output "RESULT ytdlp=$ytdlp impersonate=$imp"',
            ].join("\n"),
          );
          expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
          expect(result.stdout).toContain("RESULT ytdlp=False impersonate=False");
          expect(result.stdout).toContain("winget install --id yt-dlp.yt-dlp -e");
          expect(result.stdout).toContain(
            "https://github.com/lexiforest/curl-impersonate/releases",
          );
          expect(existsSync(join(sandbox.dataDir, "deps", "yt-dlp", "yt-dlp.exe"))).toBe(false);
          expect(existsSync(join(sandbox.dataDir, "deps", "curl-impersonate"))).toBe(false);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("verified already-present dest files skip the GitHub download", async () => {
    const sandbox = createInstallerSandbox("install-ps1-portable-helpers-present");
    mkdirSync(join(sandbox.dataDir, "deps", "yt-dlp"), { recursive: true });
    mkdirSync(join(sandbox.dataDir, "deps", "curl-impersonate"), { recursive: true });
    const ytdlpBody = "MZ-already-present\n";
    const ytdlpDigest = createHash("sha256").update(ytdlpBody).digest("hex");
    writeFileSync(join(sandbox.dataDir, "deps", "yt-dlp", "yt-dlp.exe"), ytdlpBody);
    writeFileSync(join(sandbox.dataDir, "deps", "yt-dlp", "yt-dlp.exe.sha256"), `${ytdlpDigest}\n`);
    writeFileSync(
      join(sandbox.dataDir, "deps", "curl-impersonate", "curl_chrome146.bat"),
      "@echo off\r\n",
    );
    const backendBody = "MZ-curl-impersonate\n";
    const backendDigest = createHash("sha256").update(backendBody).digest("hex");
    writeFileSync(
      join(sandbox.dataDir, "deps", "curl-impersonate", "curl-impersonate.exe"),
      backendBody,
    );
    writeFileSync(
      join(sandbox.dataDir, "deps", "curl-impersonate", ".kunai-source.sha256"),
      `${"f7faa8c42b63b4a96245429e46956e11ae7d7076d60f65768c0018d3bb18d7e5"}\n`,
    );
    writeFileSync(
      join(sandbox.dataDir, "deps", "curl-impersonate", ".kunai-backend.sha256"),
      `${backendDigest}\n`,
    );
    try {
      await withReleaseFixture({}, async (_baseUrl, evidence) => {
        const result = await runPortableHelperProbe(
          {
            ...isolatedHelperEnv(sandbox),
            KUNAI_YTDLP_RELEASE_BASE: "http://127.0.0.1:1",
            KUNAI_CURL_IMPERSONATE_RELEASE_BASE: "http://127.0.0.1:1",
          },
          [
            "$ytdlp = [bool](Install-PortableYtDlp)",
            "$imp = [bool](Install-PortableCurlImpersonate)",
            'Write-Output "RESULT ytdlp=$ytdlp impersonate=$imp"',
          ].join("\n"),
        );
        expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
        expect(result.stdout).toContain("RESULT ytdlp=True impersonate=True");
        expect(result.stdout).toContain("yt-dlp already present");
        expect(result.stdout).toContain("curl-impersonate already present");
        expect(evidence.requests).toEqual([]);
      });
    } finally {
      sandbox.cleanup();
    }
  });

  test("repairs unverified managed helpers instead of trusting their filenames", async () => {
    const sandbox = createInstallerSandbox("install-ps1-portable-helpers-repair");
    const ytdlpDir = join(sandbox.dataDir, "deps", "yt-dlp");
    const impersonateDir = join(sandbox.dataDir, "deps", "curl-impersonate");
    mkdirSync(ytdlpDir, { recursive: true });
    mkdirSync(impersonateDir, { recursive: true });
    writeFileSync(join(ytdlpDir, "yt-dlp.exe"), "");
    writeFileSync(join(impersonateDir, "curl_chrome146.bat"), "@echo off\r\n");

    const ytdlpBody = "MZ-repaired-yt-dlp\n";
    const ytdlpDigest = createHash("sha256").update(ytdlpBody).digest("hex");
    const archive = createCurlImpersonateArchive(sandbox.root);
    try {
      await withReleaseFixture(
        {
          "/SHA2-256SUMS": { body: `${ytdlpDigest}  yt-dlp.exe\n` },
          "/yt-dlp.exe": { body: ytdlpBody },
          [`/${archive.asset}`]: { body: archive.bytes },
        },
        async (baseUrl, evidence) => {
          const result = await runPortableHelperProbe(
            {
              ...isolatedHelperEnv(sandbox),
              KUNAI_YTDLP_RELEASE_BASE: baseUrl,
              KUNAI_CURL_IMPERSONATE_RELEASE_BASE: baseUrl,
              KUNAI_CURL_IMPERSONATE_SHA256: archive.sha256,
            },
            [
              "$ytdlp = [bool](Install-PortableYtDlp)",
              "$imp = [bool](Install-PortableCurlImpersonate)",
              'Write-Output "RESULT ytdlp=$ytdlp impersonate=$imp"',
            ].join("\n"),
          );

          expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
          expect(result.stdout).toContain("RESULT ytdlp=True impersonate=True");
          expect(readFileSync(join(ytdlpDir, "yt-dlp.exe"), "utf8")).toBe(ytdlpBody);
          expect(existsSync(join(impersonateDir, "curl-impersonate.exe"))).toBe(true);
          expect(evidence.requests).toContain("/SHA2-256SUMS");
          expect(evidence.requests).toContain("/yt-dlp.exe");
          expect(evidence.requests).toContain(`/${archive.asset}`);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  test("replaces a leftover dest directory without nesting extract", async () => {
    const sandbox = createInstallerSandbox("install-ps1-portable-helpers-replace");
    const destDir = join(sandbox.dataDir, "deps", "curl-impersonate");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "leftover.txt"), "stale");
    const ytdlpBody = "MZ-portable-yt-dlp-replace\n";
    const ytdlpDigest = createHash("sha256").update(ytdlpBody).digest("hex");
    const archive = createCurlImpersonateArchive(sandbox.root);
    try {
      await withReleaseFixture(
        {
          "/SHA2-256SUMS": { body: `${ytdlpDigest}  yt-dlp.exe\n` },
          "/yt-dlp.exe": { body: ytdlpBody },
          [`/${archive.asset}`]: { body: archive.bytes },
        },
        async (baseUrl) => {
          const result = await runPortableHelperProbe(
            {
              ...isolatedHelperEnv(sandbox),
              KUNAI_YTDLP_RELEASE_BASE: baseUrl,
              KUNAI_CURL_IMPERSONATE_RELEASE_BASE: baseUrl,
              KUNAI_CURL_IMPERSONATE_VERSION: "v2.2.1",
              KUNAI_CURL_IMPERSONATE_SHA256: archive.sha256,
            },
            [
              "$ytdlp = [bool](Install-PortableYtDlp)",
              "$imp = [bool](Install-PortableCurlImpersonate)",
              'Write-Output "RESULT ytdlp=$ytdlp impersonate=$imp"',
            ].join("\n"),
          );
          expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
          expect(result.stdout).toContain("RESULT ytdlp=True impersonate=True");
          expect(existsSync(join(destDir, "leftover.txt"))).toBe(false);
          expect(existsSync(join(destDir, "extract"))).toBe(false);
          expect(existsSync(join(destDir, "curl_chrome146.bat"))).toBe(true);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  });

  /**
   * `chmod 0o500` is only a lock for a user the mode bits apply to. Windows
   * ACLs are not chmod at all, and root ignores the bits outright — under
   * either, `Remove-Item -Recurse` succeeds, the fail-closed branch is never
   * reached, and the assertions below quietly test nothing. Skip rather than
   * pass vacuously: a container suite running as uid 0 is the common case.
   */
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "does not nest extract when a locked dest directory cannot be replaced",
    async () => {
      const sandbox = createInstallerSandbox("install-ps1-portable-helpers-locked");
      const destDir = join(sandbox.dataDir, "deps", "curl-impersonate");
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, "leftover.txt"), "locked");
      chmodSync(destDir, 0o500);
      const ytdlpBody = "MZ-portable-yt-dlp-locked\n";
      const ytdlpDigest = createHash("sha256").update(ytdlpBody).digest("hex");
      const archive = createCurlImpersonateArchive(sandbox.root);
      try {
        await withReleaseFixture(
          {
            "/SHA2-256SUMS": { body: `${ytdlpDigest}  yt-dlp.exe\n` },
            "/yt-dlp.exe": { body: ytdlpBody },
            [`/${archive.asset}`]: { body: archive.bytes },
          },
          async (baseUrl) => {
            const result = await runPortableHelperProbe(
              {
                ...isolatedHelperEnv(sandbox),
                KUNAI_YTDLP_RELEASE_BASE: baseUrl,
                KUNAI_CURL_IMPERSONATE_RELEASE_BASE: baseUrl,
                KUNAI_CURL_IMPERSONATE_VERSION: "v2.2.1",
                KUNAI_CURL_IMPERSONATE_SHA256: archive.sha256,
              },
              [
                "$ytdlp = [bool](Install-PortableYtDlp)",
                "$imp = [bool](Install-PortableCurlImpersonate)",
                'Write-Output "RESULT ytdlp=$ytdlp impersonate=$imp"',
              ].join("\n"),
            );
            expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
            expect(result.stdout).toContain("RESULT ytdlp=True impersonate=False");
            expect(result.stdout).toContain(
              "Could not replace the existing curl-impersonate directory",
            );
            expect(existsSync(join(destDir, "extract"))).toBe(false);
            expect(existsSync(join(destDir, "curl_chrome146.bat"))).toBe(false);
            expect(existsSync(join(destDir, "leftover.txt"))).toBe(true);
          },
        );
      } finally {
        chmodSync(destDir, 0o755);
        sandbox.cleanup();
      }
    },
  );
});

/**
 * Windows parity for the PATH-conflict remediation added to install.sh. The
 * PowerShell version tested only the winner, and only against npm, so every
 * other manager fell through to a generic "move $BinDir ahead" line and never
 * learned the command that removes the competing install.
 */
describePwsh("install.ps1 PATH conflict remediation", () => {
  function extractFn(name: string): string {
    return `Invoke-Expression ([regex]::Match($src, "(?ms)^function ${name} \\{.*?^\\}").Value)`;
  }

  function evalPathFns(body: string): string {
    const script = [
      `$src = Get-Content -Raw ${JSON.stringify(INSTALL_PS1)}`,
      'function Write-Info { param($m) Write-Host "> $m" }',
      'function Write-Warn { param($m) Write-Host "! $m" }',
      '$Package = "@kitsunekode/kunai"',
      extractFn("Get-PathConflictRemedy"),
      extractFn("Write-KunaiPathDiagnostic"),
      body,
    ].join("\n");
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    expect(result.stderr, result.stderr).not.toContain("ParserError");
    return `${result.stdout}${result.stderr}`;
  }

  function remedyTable(): Record<string, string> {
    const probe = [
      "foreach ($e in @(",
      '  "C:\\Users\\u\\.bun\\bin\\kunai.exe",',
      '  "C:\\Users\\u\\AppData\\Roaming\\npm\\kunai.cmd",',
      '  "C:\\Users\\u\\AppData\\Roaming\\nvm\\v22\\kunai.cmd",',
      '  "C:\\Users\\u\\AppData\\Local\\fnm_multishells\\123_456\\kunai.cmd",',
      '  "C:\\Users\\u\\AppData\\Local\\pnpm\\kunai.exe",',
      '  "C:\\Users\\u\\.yarn\\bin\\kunai.cmd",',
      '  "C:\\Users\\u\\scoop\\shims\\kunai.exe",',
      '  "C:\\ProgramData\\chocolatey\\bin\\kunai.exe",',
      '  "C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages\\kunai.exe",',
      '  "C:\\tools\\kunai.exe")) {',
      '  Write-Output "$e|$(Get-PathConflictRemedy $e)"',
      "}",
    ].join("\n");
    return Object.fromEntries(
      evalPathFns(probe)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.includes("|"))
        .map((line) => {
          const index = line.lastIndexOf("|");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
  }

  test("each Windows package manager maps to its own removal command", () => {
    const table = remedyTable();
    expect(table["C:\\Users\\u\\.bun\\bin\\kunai.exe"]).toBe(
      "bun remove --global @kitsunekode/kunai",
    );
    expect(table["C:\\Users\\u\\AppData\\Roaming\\npm\\kunai.cmd"]).toBe(
      "npm uninstall -g @kitsunekode/kunai",
    );
    expect(table["C:\\Users\\u\\AppData\\Roaming\\nvm\\v22\\kunai.cmd"]).toBe(
      "npm uninstall -g @kitsunekode/kunai",
    );
    expect(table["C:\\Users\\u\\AppData\\Local\\fnm_multishells\\123_456\\kunai.cmd"]).toBe(
      "npm uninstall -g @kitsunekode/kunai",
    );
    expect(table["C:\\Users\\u\\AppData\\Local\\pnpm\\kunai.exe"]).toBe(
      "pnpm remove --global @kitsunekode/kunai",
    );
    expect(table["C:\\Users\\u\\.yarn\\bin\\kunai.cmd"]).toBe(
      "yarn global remove @kitsunekode/kunai",
    );
    expect(table["C:\\Users\\u\\scoop\\shims\\kunai.exe"]).toBe("scoop uninstall kunai");
    expect(table["C:\\ProgramData\\chocolatey\\bin\\kunai.exe"]).toBe("choco uninstall kunai");
    expect(table["C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages\\kunai.exe"]).toBe(
      "winget uninstall kunai",
    );
  });

  test("an unrecognised install still yields a line naming its path", () => {
    expect(remedyTable()["C:\\tools\\kunai.exe"]).toBe("# remove or rename C:\\tools\\kunai.exe");
  });

  test("a conflict lists every competing install, not only the winner", () => {
    const output = evalPathFns(
      [
        "$BinDir = 'C:\\Users\\u\\AppData\\Local\\kunai\\bin'",
        "function Get-KunaiPathCandidates {",
        "  return @(",
        "    'C:\\Users\\u\\AppData\\Roaming\\npm\\kunai.cmd',",
        "    'C:\\Users\\u\\.bun\\bin\\kunai.exe',",
        "    'C:\\Users\\u\\AppData\\Local\\kunai\\bin\\kunai.exe'",
        "  )",
        "}",
        "Write-KunaiPathDiagnostic 'C:\\Users\\u\\AppData\\Local\\kunai\\bin\\kunai.exe'",
      ].join("\n"),
    );
    expect(output).toContain("Another kunai comes earlier on your PATH");
    expect(output).toContain("C:\\Users\\u\\AppData\\Roaming\\npm\\kunai.cmd");
    expect(output).toContain("C:\\Users\\u\\.bun\\bin\\kunai.exe");
    expect(output).toContain("npm uninstall -g @kitsunekode/kunai");
    expect(output).toContain("bun remove --global @kitsunekode/kunai");
    expect(output).toContain("put C:\\Users\\u\\AppData\\Local\\kunai\\bin earlier in your PATH");
    expect(output).toContain("Get-Command kunai -All");
  });
});

/**
 * Parity with install.sh: a payload on a console gets one \\r-updated line,
 * and a failed transfer wipes it so the error is not printed under a 100% bar.
 */
describePwsh("install.ps1 download progress", () => {
  function evalProgressFns(body: string): string {
    const script = [
      `$src = Get-Content -Raw ${JSON.stringify(INSTALL_PS1)}`,
      'Invoke-Expression ([regex]::Match($src, "(?ms)^function Format-ByteSize \\{.*?^\\}").Value)',
      'Invoke-Expression ([regex]::Match($src, "(?ms)^function Write-DownloadProgress \\{.*?^\\}").Value)',
      'Invoke-Expression ([regex]::Match($src, "(?ms)^function Clear-DownloadProgress \\{.*?^\\}").Value)',
      body,
    ].join("\n");
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    expect(result.stderr, result.stderr).not.toContain("ParserError");
    return `${result.stdout}${result.stderr}`;
  }

  test("a completed payload renders size, rate, bar and percent", () => {
    const output = evalProgressFns(
      "Write-DownloadProgress -Label 'kunai-windows-x64.zip' -Received 40894464 -Total 40894464 -Seconds 8; Write-Host ''",
    );
    expect(output).toContain("kunai-windows-x64.zip");
    expect(output).toMatch(/MiB/);
    expect(output).toContain("[####################]");
    expect(output).toContain("100%");
  });

  test("byte sizes use a dot so a non-English host still matches install.sh", () => {
    const output = evalProgressFns("Write-Output (Format-ByteSize 1048576)");
    expect(output.trim()).toBe("1.0 MiB");
  });

  test("Invoke-BoundedDownload wipes a failed transfer instead of drawing 100%", () => {
    const source = readFileSync(INSTALL_PS1, "utf8");
    const fn = /^function Invoke-BoundedDownload \{[\s\S]*?^\}/m.exec(source)?.[0];
    expect(fn, "could not extract Invoke-BoundedDownload").toBeTruthy();
    expect(fn!).toContain("Clear-DownloadProgress");
    expect(fn!).toContain("DownloadProgressMinBytes");
    // Final frame only on a finished payload, matching install.sh after #322.
    expect(fn!).toMatch(/Write-DownloadProgress[\s\S]*Write-DownloadProgress/);
  });
});
