#!/usr/bin/env bun

/**
 * Atomically set publication status on one exact `.release/kunai-vX.Y.Z.json`.
 *
 * Usage:
 *   bun run scripts/set-release-status.ts <version> <staged|published|withdrawn> [publishedAt]
 *
 * Examples:
 *   bun run scripts/set-release-status.ts 0.3.0 published 2026-07-20T12:00:00Z
 *   bun run scripts/set-release-status.ts 0.2.6 staged
 *   bun run scripts/set-release-status.ts 0.2.5 withdrawn
 *
 * Preserves assets and all note body fields. Only rewrites the JSON artifact
 * (markdown is status-agnostic).
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  RELEASE_ARTIFACT_SCHEMA_VERSION,
  isReleasePublicationStatus,
  transitionReleaseStatus,
  type ReleaseNotesArtifact,
  type ReleasePublicationStatus,
} from "./release-artifact.ts";

const REPO_ROOT = join(import.meta.dirname, "..");
const RELEASE_DIR = join(REPO_ROOT, ".release");

function usage(): never {
  console.error(
    "Usage: bun run scripts/set-release-status.ts <version> <staged|published|withdrawn> [publishedAt]",
  );
  process.exit(1);
}

function parseArgs(argv: readonly string[]): {
  readonly version: string;
  readonly status: ReleasePublicationStatus;
  readonly publishedAt: string | undefined;
} {
  const version = argv[0];
  const statusArg = argv[1];
  const publishedAt = argv[2];

  if (!version || !statusArg) usage();
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    console.error(`Invalid version: ${version}`);
    usage();
  }
  if (!isReleasePublicationStatus(statusArg)) {
    console.error(`Invalid status: ${statusArg}`);
    usage();
  }
  return { version, status: statusArg, publishedAt };
}

function artifactJsonPath(version: string): string {
  return join(RELEASE_DIR, `kunai-v${version}.json`);
}

/** Crash-safe replace: temp file in the same directory + rename. */
function writeAtomicJson(path: string, value: unknown): void {
  const tmp = join(
    dirname(path),
    `.kunai-v-status.${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`,
  );
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

export function setReleaseStatus(input: {
  readonly version: string;
  readonly status: ReleasePublicationStatus;
  readonly publishedAt?: string;
  readonly repoRoot?: string;
}): ReleaseNotesArtifact {
  const releaseDir = join(input.repoRoot ?? REPO_ROOT, ".release");
  const path = join(releaseDir, `kunai-v${input.version}.json`);
  if (!existsSync(path)) {
    throw new Error(`release artifact missing: ${path}`);
  }

  const onDisk = JSON.parse(readFileSync(path, "utf8")) as ReleaseNotesArtifact;
  if (onDisk.version !== input.version) {
    throw new Error(
      `version mismatch: path is ${input.version} but artifact.version is ${onDisk.version}`,
    );
  }
  if (onDisk.schemaVersion !== RELEASE_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `expected schemaVersion ${RELEASE_ARTIFACT_SCHEMA_VERSION}, got ${String(onDisk.schemaVersion)} — migrate the artifact first`,
    );
  }

  const next = transitionReleaseStatus(onDisk, input.status, input.publishedAt);
  writeAtomicJson(path, next);
  return next;
}

async function main(): Promise<void> {
  const { version, status, publishedAt } = parseArgs(process.argv.slice(2));
  const path = artifactJsonPath(version);
  const next = setReleaseStatus({ version, status, publishedAt });
  console.log(
    `[set-release-status] ${path} → status=${next.status} publishedAt=${next.publishedAt ?? "null"}`,
  );
}

if (import.meta.main) {
  await main();
}
