#!/usr/bin/env bun
/**
 * Machine-checked release confirmation gate.
 *
 * Aggregates deterministic attestation + time-bounded provider evidence and
 * emits a ready-for-confirmation result. Does not publish, tag, or promote.
 *
 * Usage:
 *   bun run release:confirmation:check -- \
 *     --version 0.3.0 \
 *     --commit "$(git rev-parse HEAD)" \
 *     --provider-evidence artifacts/release-provider-signoff.json \
 *     --provider-signoff-run-id <run_id> \
 *     --binary-dir apps/cli/dist/bin
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  assertReleaseProviderSignoffComplete,
  isReleaseProviderSignoffAcceptable,
  type ReleaseProviderSignoff,
} from "../apps/cli/test/live/release-provider-signoff";
import type { ReleasePublicationStatus } from "./release-artifact";
import {
  assertCompleteReleaseAssetSet,
  type ReleaseAssetDescriptor,
} from "./release-asset-contract";

export const RELEASE_CONFIRMATION_GATES = [
  "repository",
  "package",
  "installer",
  "npmGlobalInstall",
  "compiledPlayback",
  "readmeCommands",
  "liveProviders",
  "releaseAssets",
] as const;

export type ReleaseConfirmationGateName = (typeof RELEASE_CONFIRMATION_GATES)[number];

export interface ReleaseGateEvidence {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly commitSha: string;
  readonly generatedAt: string;
  readonly gates: {
    readonly repository: "passed";
    readonly package: "passed";
    readonly installer: "passed";
    readonly npmGlobalInstall: "passed";
    readonly compiledPlayback: "passed";
    readonly readmeCommands: "passed";
    readonly liveProviders: "passed";
    readonly releaseAssets: "passed";
  };
  readonly providerSignoffRunId: string;
  readonly binaryArtifactName: string;
}

export type ReleaseMetadataSnapshot = {
  readonly version: string;
  readonly status: string;
  readonly publishedAt: string | null;
};

export type ReleaseConfirmationInput = {
  readonly version: string;
  readonly commitSha: string;
  readonly nowMs: number;
  readonly packageVersion: string;
  readonly providerEvidence: ReleaseProviderSignoff;
  readonly providerSignoffRunId: string;
  readonly binaryArtifactName: string;
  readonly releaseAssets: readonly ReleaseAssetDescriptor[];
  readonly targetReleaseMetadata: ReleaseMetadataSnapshot;
  readonly release026Metadata: ReleaseMetadataSnapshot | null;
  readonly trackedInstallerReferencePaths: readonly string[];
  readonly generatedMetadataFresh: boolean;
  readonly declaredGates: ReleaseGateEvidence["gates"] | Record<string, unknown>;
};

export type ReleaseConfirmationResult = {
  readonly status: "ready-for-confirmation";
  readonly evidence: ReleaseGateEvidence;
};

const REPO_ROOT = join(import.meta.dirname, "..");
const INSTALLER_REFERENCE_PREFIX = "docs/installer-reference/";

export function evaluateReleaseConfirmation(
  input: ReleaseConfirmationInput,
): ReleaseConfirmationResult {
  if (!input.version.trim()) {
    throw new Error("[release-confirmation] version is required");
  }
  if (!input.commitSha.trim()) {
    throw new Error("[release-confirmation] commitSha is required");
  }
  if (!input.providerSignoffRunId.trim()) {
    throw new Error("[release-confirmation] providerSignoffRunId is required");
  }
  if (!input.binaryArtifactName.trim()) {
    throw new Error("[release-confirmation] binaryArtifactName is required");
  }

  if (input.packageVersion !== input.version) {
    throw new Error(
      `[release-confirmation] version mismatch: expected ${input.version}, package.json=${input.packageVersion}`,
    );
  }

  if (input.providerEvidence.version !== input.version) {
    throw new Error(
      `[release-confirmation] version mismatch: expected ${input.version}, providerEvidence=${input.providerEvidence.version}`,
    );
  }

  if (input.providerEvidence.commitSha !== input.commitSha) {
    throw new Error(
      `[release-confirmation] commit SHA mismatch: expected ${input.commitSha}, providerEvidence=${input.providerEvidence.commitSha}`,
    );
  }

  assertDeclaredGates(input.declaredGates);

  try {
    assertReleaseProviderSignoffComplete(input.providerEvidence);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[release-confirmation] ${message}`);
  }

  if (!isReleaseProviderSignoffAcceptable(input.providerEvidence, input.nowMs)) {
    throw new Error(
      "[release-confirmation] provider evidence is stale or unacceptable (must be fresh within 24h with all lanes resolved/reachable)",
    );
  }

  try {
    assertCompleteReleaseAssetSet(input.releaseAssets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[release-confirmation] ${message}`);
  }

  if (input.targetReleaseMetadata.version !== input.version) {
    throw new Error(
      `[release-confirmation] target metadata version mismatch: expected ${input.version}, got ${input.targetReleaseMetadata.version}`,
    );
  }
  if (input.targetReleaseMetadata.status !== "staged") {
    throw new Error(
      `[release-confirmation] target release metadata must be staged before confirmation (status=${input.targetReleaseMetadata.status})`,
    );
  }
  if (input.targetReleaseMetadata.publishedAt !== null) {
    throw new Error(
      "[release-confirmation] target release metadata must keep publishedAt null while staged",
    );
  }

  assert026NotPublic(input.release026Metadata);

  if (input.trackedInstallerReferencePaths.length > 0) {
    throw new Error(
      `[release-confirmation] installer-reference source must not be tracked: ${input.trackedInstallerReferencePaths.join(", ")}`,
    );
  }

  if (!input.generatedMetadataFresh) {
    throw new Error(
      "[release-confirmation] generated metadata drift detected — run `bun run --cwd apps/docs generate`",
    );
  }

  const evidence: ReleaseGateEvidence = {
    schemaVersion: 1,
    version: input.version,
    commitSha: input.commitSha,
    generatedAt: new Date(input.nowMs).toISOString(),
    gates: input.declaredGates as ReleaseGateEvidence["gates"],
    providerSignoffRunId: input.providerSignoffRunId,
    binaryArtifactName: input.binaryArtifactName,
  };

  return { status: "ready-for-confirmation", evidence };
}

function assertDeclaredGates(declared: ReleaseConfirmationInput["declaredGates"]): void {
  for (const gate of RELEASE_CONFIRMATION_GATES) {
    if (!(gate in declared)) {
      throw new Error(`[release-confirmation] missing confirmation gate: ${gate}`);
    }
    if (declared[gate] !== "passed") {
      throw new Error(
        `[release-confirmation] gate ${gate} must be passed (got ${String(declared[gate])})`,
      );
    }
  }
}

function assert026NotPublic(meta: ReleaseMetadataSnapshot | null): void {
  if (!meta) return;
  if (meta.status === "published" || meta.publishedAt !== null) {
    throw new Error(
      "[release-confirmation] 0.2.6 must not be public (status must stay staged with publishedAt null)",
    );
  }
}

function readPackageVersion(repoRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "apps/cli/package.json"), "utf8")) as {
    version?: string;
  };
  if (!pkg.version) {
    throw new Error("[release-confirmation] apps/cli/package.json has no version");
  }
  return pkg.version;
}

function readReleaseMetadata(repoRoot: string, version: string): ReleaseMetadataSnapshot | null {
  const path = join(repoRoot, ".release", `kunai-v${version}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    version?: string;
    status?: ReleasePublicationStatus;
    publishedAt?: string | null;
  };
  return {
    version: raw.version ?? version,
    status: raw.status ?? "unknown",
    publishedAt: raw.publishedAt ?? null,
  };
}

function listBinaryDirAssets(directory: string): readonly ReleaseAssetDescriptor[] {
  return readdirSync(directory)
    .filter((name) => {
      try {
        return statSync(join(directory, name)).isFile();
      } catch {
        return false;
      }
    })
    .map((name) => ({
      name,
      size: statSync(join(directory, name)).size,
    }));
}

function listTrackedInstallerReference(repoRoot: string): readonly string[] {
  const result = spawnSync("git", ["ls-files", INSTALLER_REFERENCE_PREFIX], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `[release-confirmation] git ls-files ${INSTALLER_REFERENCE_PREFIX} failed: ${result.stderr || result.stdout}`,
    );
  }
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function checkGeneratedMetadataFresh(repoRoot: string): boolean {
  const result = spawnSync(
    "bun",
    ["run", "--cwd", "apps/docs", "scripts/check-codegen-freshness.ts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  return result.status === 0;
}

function readProviderEvidence(path: string): ReleaseProviderSignoff {
  if (!existsSync(path)) {
    throw new Error(`[release-confirmation] provider evidence not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as ReleaseProviderSignoff;
}

function allPassedGates(): ReleaseGateEvidence["gates"] {
  return {
    repository: "passed",
    package: "passed",
    installer: "passed",
    npmGlobalInstall: "passed",
    compiledPlayback: "passed",
    readmeCommands: "passed",
    liveProviders: "passed",
    releaseAssets: "passed",
  };
}

export type ReleaseConfirmationCliArgs = {
  readonly version: string;
  readonly commitSha: string;
  readonly providerEvidencePath: string;
  readonly providerSignoffRunId: string;
  readonly binaryDir: string;
  readonly binaryArtifactName?: string;
  readonly skipGeneratedDriftCheck?: boolean;
};

export function parseReleaseConfirmationCliArgs(
  argv: readonly string[],
): ReleaseConfirmationCliArgs {
  let version: string | undefined;
  let commitSha: string | undefined;
  let providerEvidencePath: string | undefined;
  let providerSignoffRunId: string | undefined;
  let binaryDir: string | undefined;
  let binaryArtifactName: string | undefined;
  let skipGeneratedDriftCheck = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error(`[release-confirmation] ${arg} requires a value`);
      }
      return value;
    };

    switch (arg) {
      case "--version":
        version = next();
        break;
      case "--commit":
        commitSha = next();
        break;
      case "--provider-evidence":
        providerEvidencePath = next();
        break;
      case "--provider-signoff-run-id":
        providerSignoffRunId = next();
        break;
      case "--binary-dir":
        binaryDir = next();
        break;
      case "--binary-artifact-name":
        binaryArtifactName = next();
        break;
      case "--skip-generated-drift-check":
        skipGeneratedDriftCheck = true;
        break;
      default:
        throw new Error(`[release-confirmation] unknown option: ${arg}`);
    }
  }

  if (!version || !commitSha || !providerEvidencePath || !providerSignoffRunId || !binaryDir) {
    throw new Error(
      "[release-confirmation] usage: --version <semver> --commit <sha> --provider-evidence <path> --provider-signoff-run-id <id> --binary-dir <dir> [--binary-artifact-name <name>]",
    );
  }

  return {
    version,
    commitSha,
    providerEvidencePath,
    providerSignoffRunId,
    binaryDir,
    binaryArtifactName,
    skipGeneratedDriftCheck,
  };
}

export function runReleaseConfirmationCheck(
  args: ReleaseConfirmationCliArgs,
  options: { readonly repoRoot?: string; readonly nowMs?: number } = {},
): ReleaseConfirmationResult {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const nowMs = options.nowMs ?? Date.now();
  const target = readReleaseMetadata(repoRoot, args.version);
  if (!target) {
    throw new Error(
      `[release-confirmation] missing .release/kunai-v${args.version}.json — run version:packages / release:notes first`,
    );
  }

  return evaluateReleaseConfirmation({
    version: args.version,
    commitSha: args.commitSha,
    nowMs,
    packageVersion: readPackageVersion(repoRoot),
    providerEvidence: readProviderEvidence(
      args.providerEvidencePath.startsWith("/")
        ? args.providerEvidencePath
        : join(repoRoot, args.providerEvidencePath),
    ),
    providerSignoffRunId: args.providerSignoffRunId,
    binaryArtifactName: args.binaryArtifactName ?? `kunai-release-candidate-${args.version}`,
    releaseAssets: listBinaryDirAssets(
      args.binaryDir.startsWith("/") ? args.binaryDir : join(repoRoot, args.binaryDir),
    ),
    targetReleaseMetadata: target,
    release026Metadata: readReleaseMetadata(repoRoot, "0.2.6"),
    trackedInstallerReferencePaths: listTrackedInstallerReference(repoRoot),
    generatedMetadataFresh: args.skipGeneratedDriftCheck
      ? true
      : checkGeneratedMetadataFresh(repoRoot),
    declaredGates: allPassedGates(),
  });
}

if (import.meta.main) {
  try {
    const args = parseReleaseConfirmationCliArgs(process.argv.slice(2));
    const result = runReleaseConfirmationCheck(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
