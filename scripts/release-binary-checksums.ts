import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ReleaseBinaryChecksum, ReleaseNotesArtifact } from "./release-artifact.ts";

export type { ReleaseBinaryChecksum };

/**
 * Only the release pipeline may author the checksums in `.release/*.json`.
 *
 * A local `build-binaries` run produces binaries that are byte-different from
 * CI's (different toolchain, paths, timestamps), so merging its SHA256SUMS
 * silently replaced the committed hashes with ones no published artifact will
 * ever match. That file is what a user verifies a download against, so shipping
 * dev-machine hashes breaks verification for everyone.
 *
 * Set `KUNAI_WRITE_RELEASE_CHECKSUMS=1` to opt in deliberately.
 */
export function shouldWriteReleaseChecksums(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.KUNAI_WRITE_RELEASE_CHECKSUMS === "1") return true;
  return Boolean(env.CI?.trim());
}

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
