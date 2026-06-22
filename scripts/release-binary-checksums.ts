import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ReleaseNotesArtifact } from "./generate-release-notes.ts";

export type ReleaseBinaryChecksum = {
  readonly name: string;
  readonly sha256: string;
};

/** Parse a `SHA256SUMS` manifest (`<hex>  <filename>` per line). */
export function parseSha256sums(content: string): readonly ReleaseBinaryChecksum[] {
  const assets: ReleaseBinaryChecksum[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^([a-f0-9]{64})\s+(\S+)$/.exec(line);
    if (!match) {
      throw new Error(`invalid SHA256SUMS line: ${line}`);
    }
    assets.push({ sha256: match[1]!, name: match[2]! });
  }
  return assets;
}

export function readSha256sumsFile(path: string): readonly ReleaseBinaryChecksum[] {
  return parseSha256sums(readFileSync(path, "utf8"));
}

export function withBinaryChecksums(
  artifact: ReleaseNotesArtifact,
  checksums: readonly ReleaseBinaryChecksum[],
): ReleaseNotesArtifact {
  return { ...artifact, assets: checksums };
}

export function artifactWithoutBinaryChecksums(
  artifact: ReleaseNotesArtifact,
): ReleaseNotesArtifact {
  const { assets: _assets, ...rest } = artifact as ReleaseNotesArtifact & {
    assets?: readonly ReleaseBinaryChecksum[];
  };
  return rest;
}

export function mergeReleaseNotesChecksums(input: {
  readonly repoRoot: string;
  readonly version: string;
  readonly checksumsPath: string;
}): ReleaseNotesArtifact {
  const jsonPath = join(input.repoRoot, ".release", `kunai-v${input.version}.json`);
  if (!existsSync(jsonPath)) {
    throw new Error(`release notes artifact missing: ${jsonPath}`);
  }
  if (!existsSync(input.checksumsPath)) {
    throw new Error(`SHA256SUMS missing: ${input.checksumsPath}`);
  }

  const artifact = JSON.parse(readFileSync(jsonPath, "utf8")) as ReleaseNotesArtifact;
  const checksums = readSha256sumsFile(input.checksumsPath);
  const merged = withBinaryChecksums(artifact, checksums);
  writeFileSync(jsonPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}
