/**
 * Pure required-release-asset contract for the 0.3.0 compatibility bridge.
 *
 * Shared by:
 *   - scripts/verify-github-release-assets.ts (live gh release view / download)
 *   - scripts/verify-release-artifact-directory.ts (local 30-file verification)
 *   - apps/cli/test/unit/scripts/distribution-contract.test.ts (workflow lock)
 */

import {
  RELEASE_BINARY_TARGETS,
  releaseArchiveNames,
} from "../apps/cli/src/services/update/platform-assets";

export interface ReleaseAssetDescriptor {
  readonly name: string;
  readonly size: number;
}

export const REQUIRED_BINARY_ASSET_NAMES = Object.freeze(
  RELEASE_BINARY_TARGETS.map((target) => target.out).sort(),
);

/** Compatibility archives (`.tar.gz`/`.zip`) plus the zstd archive of every tar target. */
export const REQUIRED_ARCHIVE_ASSET_NAMES = Object.freeze(
  RELEASE_BINARY_TARGETS.flatMap(releaseArchiveNames).sort(),
);

export const REQUIRED_RELEASE_ASSET_NAMES = Object.freeze(
  [
    ...REQUIRED_ARCHIVE_ASSET_NAMES,
    ...REQUIRED_BINARY_ASSET_NAMES,
    "SHA256SUMS",
    "SHA256SUMS.archives",
  ].sort(),
);

/** Alias used by contract tests / brief wording. */
export const requiredAssetNames = REQUIRED_RELEASE_ASSET_NAMES;

export function assertRequiredReleaseAssets(actualNames: readonly string[]): void {
  const actual = new Set(actualNames);
  const missing = REQUIRED_RELEASE_ASSET_NAMES.filter((name) => !actual.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[release-assets] release is missing ${missing.length} required asset(s): ${missing.join(", ")}`,
    );
  }
}

/**
 * Exact 30-file set: ten compatibility archives, eight `.tar.zst` archives,
 * ten raw binaries, and two manifests.
 * Rejects missing, duplicate, unexpected, and zero-byte assets.
 */
export function assertCompleteReleaseAssetSet(
  assets: readonly ReleaseAssetDescriptor[],
  requiredNames: readonly string[] = REQUIRED_RELEASE_ASSET_NAMES,
): void {
  const seen = new Map<string, number>();
  for (const asset of assets) {
    const count = (seen.get(asset.name) ?? 0) + 1;
    seen.set(asset.name, count);
    if (count > 1) {
      throw new Error(`[release-assets] duplicate asset: ${asset.name}`);
    }
  }

  const unexpected = [...seen.keys()].filter((name) => !requiredNames.includes(name));
  if (unexpected.length > 0) {
    throw new Error(`[release-assets] unexpected asset(s): ${unexpected.sort().join(", ")}`);
  }

  const missing = requiredNames.filter((name) => !seen.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[release-assets] release is missing ${missing.length} required asset(s): ${missing.join(", ")}`,
    );
  }

  for (const asset of assets) {
    if (asset.size <= 0) {
      throw new Error(`[release-assets] zero-byte required asset: ${asset.name}`);
    }
    if (asset.name.endsWith(".sig") && asset.size !== 64) {
      throw new Error(`[release-assets] invalid Ed25519 signature size for ${asset.name}`);
    }
    const target = RELEASE_BINARY_TARGETS.find(
      (entry) => entry.out === asset.name || releaseArchiveNames(entry).includes(asset.name),
    );
    const maxBytes =
      target?.out === asset.name
        ? target.maxBinaryBytes
        : target
          ? target.maxArchiveBytes
          : asset.name === "install.sh" || asset.name === "install.ps1"
            ? 256 * 1024
            : 64 * 1024;
    if (asset.size > maxBytes) {
      throw new Error(
        `[release-assets] size budget exceeded for ${asset.name}: ${asset.size} > ${maxBytes}`,
      );
    }
  }
}
