import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  RELEASE_BINARY_TARGETS,
  resolveHostReleaseBinaryTarget,
} from "@/services/update/platform-assets";
import { parseCanonicalVersion } from "@/services/update/version";

import { createInstallerSandbox, withReleaseFixture } from "./helpers/installer-script-harness";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const CANDIDATE_DIR = process.env.KUNAI_RELEASE_CANDIDATE_DIR?.trim();
const CANDIDATE_VERSION = process.env.KUNAI_RELEASE_CANDIDATE_VERSION?.trim();
const CANDIDATE_ASSET = process.env.KUNAI_RELEASE_CANDIDATE_ASSET?.trim();
const RUN_SMOKE = Boolean(CANDIDATE_DIR || CANDIDATE_VERSION || CANDIDATE_ASSET);

async function runCommand(
  command: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ readonly status: number; readonly stdout: string; readonly stderr: string }> {
  const proc = Bun.spawn([...command], {
    cwd: REPO_ROOT,
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

const describeCandidate = RUN_SMOKE ? describe : describe.skip;

describeCandidate("preserved native installer smoke", () => {
  test("installs and executes the exact host archive without raw fallback", async () => {
    if (!CANDIDATE_DIR || !CANDIDATE_VERSION || !CANDIDATE_ASSET) {
      throw new Error("All preserved candidate environment variables are required");
    }

    const version = parseCanonicalVersion(CANDIDATE_VERSION);
    if (!version) throw new Error(`Invalid candidate version: ${CANDIDATE_VERSION}`);
    const target = RELEASE_BINARY_TARGETS.find((entry) => entry.out === CANDIDATE_ASSET);
    if (!target) throw new Error(`Unknown candidate asset: ${CANDIDATE_ASSET}`);
    const hostTarget = resolveHostReleaseBinaryTarget({ libc: "gnu" });
    if (target.id !== hostTarget.id) {
      throw new Error(`Candidate ${target.id} does not match host ${hostTarget.id}`);
    }

    const candidateDir = resolve(CANDIDATE_DIR);
    const archivePath = join(candidateDir, target.archiveName);
    const rawSumsPath = join(candidateDir, "SHA256SUMS");
    const archiveSumsPath = join(candidateDir, "SHA256SUMS.archives");
    const archive = new Uint8Array(await Bun.file(archivePath).arrayBuffer());
    const rawSums = readFileSync(rawSumsPath, "utf8");
    const archiveSums = readFileSync(archiveSumsPath, "utf8");
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    const archiveSizeBytes = statSync(archivePath).size;
    const sandbox = createInstallerSandbox(`preserved-${target.id}`);

    try {
      await withReleaseFixture(
        {
          [`/download/v${version}/SHA256SUMS.archives`]: { body: archiveSums },
          [`/download/v${version}/${target.archiveName}`]: { body: archive },
          [`/download/v${version}/SHA256SUMS`]: { body: rawSums },
        },
        async (baseUrl, evidence) => {
          const env = {
            ...sandbox.env,
            KUNAI_DL_BASE: baseUrl,
            KUNAI_SKIP_PATH_UPDATE: "1",
          };
          const installCommand =
            process.platform === "win32"
              ? [
                  "pwsh",
                  "-NoProfile",
                  "-File",
                  join(REPO_ROOT, "install.ps1"),
                  "-Method",
                  "binary",
                  "-Version",
                  version,
                  "-Yes",
                  "-SkipDeps",
                  "-SkipPathUpdate",
                ]
              : [
                  "bash",
                  join(REPO_ROOT, "install.sh"),
                  "--method",
                  "binary",
                  "--version",
                  version,
                  "--yes",
                  "--skip-deps",
                  "--skip-path-update",
                ];
          const install = await runCommand(installCommand, env);
          expect(install.status, `${install.stderr}\n${install.stdout}`).toBe(0);
          expect(evidence.requests).toEqual([
            `/download/v${version}/SHA256SUMS.archives`,
            `/download/v${version}/${target.archiveName}`,
            `/download/v${version}/SHA256SUMS`,
          ]);
          expect(evidence.requests).not.toContain(`/download/v${version}/${target.out}`);

          const manifest = JSON.parse(
            readFileSync(join(sandbox.configDir, "install.json"), "utf8"),
          ) as Record<string, unknown>;
          expect(manifest).toMatchObject({
            activeVersion: version,
            artifactName: target.out,
            archiveName: target.archiveName,
            archiveSha256,
            archiveSizeBytes,
            archiveSourceUrl: `${baseUrl}/download/v${version}/${target.archiveName}`,
          });

          const launcher = join(
            sandbox.binDir,
            process.platform === "win32" ? "kunai.exe" : "kunai",
          );
          const versionResult = await runCommand([launcher, "--version"], env);
          expect(versionResult.status, versionResult.stderr).toBe(0);
          const reportedVersion = /^kunai\s+v?(\d+\.\d+\.\d+)(?:\s|$)/.exec(
            versionResult.stdout.trim(),
          )?.[1];
          expect(reportedVersion).toBe(version);
          const helpResult = await runCommand([launcher, "--help"], env);
          expect(helpResult.status, helpResult.stderr).toBe(0);
          expect(helpResult.stdout.trim().length).toBeGreaterThan(0);
        },
      );
    } finally {
      sandbox.cleanup();
    }
  }, 120_000);
});
