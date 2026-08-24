#!/usr/bin/env bun
/** Verify provenance for the exact native release payload before publication. */

import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  REQUIRED_RELEASE_ASSET_NAMES,
  assertCompleteReleaseAssetSet,
} from "./release-asset-contract";

export type AttestationCommandResult = {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type AttestationCommandRunner = (args: readonly string[]) => AttestationCommandResult;

export type VerifyNativeAttestationsInput = {
  readonly directory: string;
  readonly repository: string;
  readonly sourceDigest: string;
  readonly run?: AttestationCommandRunner;
};

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SOURCE_DIGEST_PATTERN = /^[0-9a-f]{40}$/i;

function defaultRunner(args: readonly string[]): AttestationCommandResult {
  const result = spawnSync("gh", [...args], { encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function exactReleaseFiles(directory: string): readonly string[] {
  const entries = readdirSync(directory).sort();
  const descriptors = entries.map((name) => {
    const stat = lstatSync(join(directory, name));
    if (!stat.isFile()) {
      throw new Error(`[attestation] native payload entry is not a regular file: ${name}`);
    }
    return { name, size: stat.size };
  });
  assertCompleteReleaseAssetSet(descriptors);
  return entries;
}

export function verifyNativeAttestations(input: VerifyNativeAttestationsInput): void {
  if (!REPOSITORY_PATTERN.test(input.repository)) {
    throw new Error(`[attestation] repository must be owner/name, got: ${input.repository}`);
  }
  if (!SOURCE_DIGEST_PATTERN.test(input.sourceDigest)) {
    throw new Error("[attestation] source digest must be a 40-character Git commit SHA");
  }

  const files = exactReleaseFiles(input.directory);
  const expected = [...REQUIRED_RELEASE_ASSET_NAMES].sort();
  if (files.length !== expected.length || files.some((name, index) => name !== expected[index])) {
    throw new Error("[attestation] native payload does not match the exact release asset set");
  }

  const run = input.run ?? defaultRunner;
  const signerWorkflow = `${input.repository}/.github/workflows/release.yml`;
  for (const name of files) {
    const result = run([
      "attestation",
      "verify",
      join(input.directory, name),
      "--repo",
      input.repository,
      "--signer-workflow",
      signerWorkflow,
      "--source-digest",
      input.sourceDigest,
      "--source-ref",
      "refs/heads/main",
      "--deny-self-hosted-runners",
    ]);
    if (result.status !== 0) {
      const detail = (
        result.stderr ||
        result.stdout ||
        `gh exited ${String(result.status)}`
      ).trim();
      throw new Error(`[attestation] ${name}: ${detail}`);
    }
  }
}

function parseArgs(argv: readonly string[]): Omit<VerifyNativeAttestationsInput, "run"> {
  let directory: string | undefined;
  let repository: string | undefined;
  let sourceDigest: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) break;
    if (arg === "--repo") {
      repository = argv[++index];
      continue;
    }
    if (arg === "--source-digest") {
      sourceDigest = argv[++index];
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`[attestation] unknown option: ${arg}`);
    }
    if (directory) {
      throw new Error(`[attestation] unexpected argument: ${arg}`);
    }
    directory = arg;
  }

  if (!directory || !repository || !sourceDigest) {
    throw new Error(
      "[attestation] usage: verify-native-attestations.ts <dir> --repo <owner/name> --source-digest <sha>",
    );
  }
  return { directory, repository, sourceDigest };
}

if (import.meta.main) {
  try {
    const input = parseArgs(process.argv.slice(2));
    verifyNativeAttestations(input);
    console.log(
      `[attestation] OK — verified ${REQUIRED_RELEASE_ASSET_NAMES.length} native assets from ${input.repository}@${input.sourceDigest}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
