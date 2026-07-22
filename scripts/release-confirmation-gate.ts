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
 *     --run-id <run_id> \
 *     --gate-evidence artifacts/release-gates \
 *     --gate-artifact <artifact_name>=<artifact_path> \
 *     --provider-evidence artifacts/release-provider-signoff.json \
 *     --provider-signoff-run-id <run_id> \
 *     --binary-dir apps/cli/dist/bin
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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
import {
  RELEASE_GATE_NAMES,
  loadReleaseGateEvidence,
  type ReleaseGateArtifactPath,
  type ReleaseGateName,
  type ValidatedReleaseGateEvidence,
} from "./release-gate-evidence";

export const RELEASE_CONFIRMATION_GATES = RELEASE_GATE_NAMES;
export type ReleaseConfirmationGateName = ReleaseGateName;

export interface ReleaseGateEvidence {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly commitSha: string;
  readonly generatedAt: string;
  readonly gates: Readonly<Record<ReleaseGateName, "passed">>;
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
  readonly gateEvidence: ValidatedReleaseGateEvidence;
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
  if (input.gateEvidence.version !== input.version) {
    throw new Error(
      `[release-confirmation] gate evidence version mismatch: expected ${input.version}, got ${input.gateEvidence.version}`,
    );
  }
  if (input.gateEvidence.commitSha !== input.commitSha) {
    throw new Error(
      `[release-confirmation] gate evidence commit SHA mismatch: expected ${input.commitSha}, got ${input.gateEvidence.commitSha}`,
    );
  }
  const releaseAssetsEvidence = input.gateEvidence.documents.find(
    (document) => document.gate === "releaseAssets",
  );
  if (!releaseAssetsEvidence || releaseAssetsEvidence.artifactName !== input.binaryArtifactName) {
    throw new Error(
      `[release-confirmation] releaseAssets artifact mismatch: expected ${input.binaryArtifactName}, got ${releaseAssetsEvidence?.artifactName ?? "missing"}`,
    );
  }

  try {
    assertReleaseProviderSignoffComplete(input.providerEvidence);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[release-confirmation] ${message}`, { cause: error });
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
    throw new Error(`[release-confirmation] ${message}`, { cause: error });
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
    gates: input.gateEvidence.gates,
    providerSignoffRunId: input.providerSignoffRunId,
    binaryArtifactName: input.binaryArtifactName,
  };

  return { status: "ready-for-confirmation", evidence };
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

export type ReleaseConfirmationCliArgs = {
  readonly version: string;
  readonly commitSha: string;
  readonly runId: string;
  readonly gateEvidencePaths: readonly string[];
  readonly gateArtifacts: readonly ReleaseGateArtifactPath[];
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
  let runId: string | undefined;
  const gateEvidencePaths: string[] = [];
  const gateArtifacts: ReleaseGateArtifactPath[] = [];
  let providerEvidencePath: string | undefined;
  let providerSignoffRunId: string | undefined;
  let binaryDir: string | undefined;
  let binaryArtifactName: string | undefined;
  let skipGeneratedDriftCheck = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
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
      case "--run-id":
        runId = next();
        break;
      case "--gate-evidence":
        gateEvidencePaths.push(next());
        break;
      case "--gate-artifact": {
        const mapping = next();
        const separator = mapping.indexOf("=");
        if (separator <= 0 || separator === mapping.length - 1) {
          throw new Error("[release-confirmation] --gate-artifact must use <artifact-name>=<path>");
        }
        gateArtifacts.push({
          artifactName: mapping.slice(0, separator),
          path: mapping.slice(separator + 1),
        });
        break;
      }
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

  if (
    !version ||
    !commitSha ||
    !runId ||
    gateEvidencePaths.length === 0 ||
    gateArtifacts.length === 0 ||
    !providerEvidencePath ||
    !providerSignoffRunId ||
    !binaryDir
  ) {
    throw new Error(
      "[release-confirmation] usage: --version <semver> --commit <sha> --run-id <id> --gate-evidence <file-or-dir> --gate-artifact <artifact-name>=<path> --provider-evidence <path> --provider-signoff-run-id <id> --binary-dir <dir> [--binary-artifact-name <name>]",
    );
  }

  return {
    version,
    commitSha,
    runId,
    gateEvidencePaths,
    gateArtifacts,
    providerEvidencePath,
    providerSignoffRunId,
    binaryDir,
    binaryArtifactName,
    skipGeneratedDriftCheck,
  };
}

export function assertLiveProvidersArtifactBinding(
  gateEvidence: ValidatedReleaseGateEvidence,
  gateArtifacts: readonly ReleaseGateArtifactPath[],
  providerEvidencePath: string,
): void {
  const liveProvidersEvidence = gateEvidence.documents.find(
    (document) => document.gate === "liveProviders",
  );
  const matchingArtifacts = gateArtifacts.filter(
    (artifact) => artifact.artifactName === liveProvidersEvidence?.artifactName,
  );
  const matchingArtifact = matchingArtifacts[0];
  if (
    matchingArtifacts.length !== 1 ||
    !matchingArtifact ||
    resolve(matchingArtifact.path) !== resolve(providerEvidencePath)
  ) {
    throw new Error(
      "[release-confirmation] liveProviders evidence must hash the provider signoff JSON passed to --provider-evidence",
    );
  }
}

export function runReleaseConfirmationCheck(
  args: ReleaseConfirmationCliArgs,
  options: { readonly repoRoot?: string; readonly nowMs?: number } = {},
): ReleaseConfirmationResult {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const nowMs = options.nowMs ?? Date.now();
  const resolveFromRepo = (path: string) => (path.startsWith("/") ? path : join(repoRoot, path));
  const target = readReleaseMetadata(repoRoot, args.version);
  if (!target) {
    throw new Error(
      `[release-confirmation] missing .release/kunai-v${args.version}.json — run version:packages / release:notes first`,
    );
  }

  const providerEvidencePath = resolveFromRepo(args.providerEvidencePath);
  const gateArtifacts = args.gateArtifacts.map((artifact) => ({
    artifactName: artifact.artifactName,
    path: resolveFromRepo(artifact.path),
  }));
  const gateEvidence = loadReleaseGateEvidence(
    args.gateEvidencePaths.map(resolveFromRepo),
    gateArtifacts,
    {
      version: args.version,
      commitSha: args.commitSha,
      runId: args.runId,
      providerSignoffRunId: args.providerSignoffRunId,
      nowMs,
    },
  );
  assertLiveProvidersArtifactBinding(gateEvidence, gateArtifacts, providerEvidencePath);

  return evaluateReleaseConfirmation({
    version: args.version,
    commitSha: args.commitSha,
    nowMs,
    packageVersion: readPackageVersion(repoRoot),
    providerEvidence: readProviderEvidence(providerEvidencePath),
    providerSignoffRunId: args.providerSignoffRunId,
    binaryArtifactName: args.binaryArtifactName ?? `kunai-release-candidate-${args.version}`,
    releaseAssets: listBinaryDirAssets(resolveFromRepo(args.binaryDir)),
    targetReleaseMetadata: target,
    release026Metadata: readReleaseMetadata(repoRoot, "0.2.6"),
    trackedInstallerReferencePaths: listTrackedInstallerReference(repoRoot),
    generatedMetadataFresh: args.skipGeneratedDriftCheck
      ? true
      : checkGeneratedMetadataFresh(repoRoot),
    gateEvidence,
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
