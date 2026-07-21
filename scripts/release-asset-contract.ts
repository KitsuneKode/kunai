/**
 * Pure required-release-asset contract derived from RELEASE_BINARY_TARGETS + SHA256SUMS.
 *
 * Shared by:
 *   - scripts/verify-github-release-assets.ts (live gh release view / download)
 *   - scripts/verify-release-artifact-directory.ts (local nine-file verification)
 *   - apps/cli/test/unit/scripts/distribution-contract.test.ts (workflow lock)
 */

import { RELEASE_BINARY_TARGETS } from "../apps/cli/src/services/update/platform-assets";

export interface ReleaseAssetDescriptor {
  readonly name: string;
  readonly size: number;
}

export const REQUIRED_BINARY_ASSET_NAMES = Object.freeze(
  RELEASE_BINARY_TARGETS.map((target) => target.out).sort(),
);

export const REQUIRED_RELEASE_ASSET_NAMES = Object.freeze(
  [...REQUIRED_BINARY_ASSET_NAMES, "SHA256SUMS"].sort(),
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
 * Exact nine-file set: eight binaries + SHA256SUMS.
 * Rejects missing, duplicate, unexpected, and zero-byte assets.
 */
export function assertCompleteReleaseAssetSet(assets: readonly ReleaseAssetDescriptor[]): void {
  const seen = new Map<string, number>();
  for (const asset of assets) {
    const count = (seen.get(asset.name) ?? 0) + 1;
    seen.set(asset.name, count);
    if (count > 1) {
      throw new Error(`[release-assets] duplicate asset: ${asset.name}`);
    }
  }

  const unexpected = [...seen.keys()].filter(
    (name) => !(REQUIRED_RELEASE_ASSET_NAMES as readonly string[]).includes(name),
  );
  if (unexpected.length > 0) {
    throw new Error(`[release-assets] unexpected asset(s): ${unexpected.sort().join(", ")}`);
  }

  const missing = REQUIRED_RELEASE_ASSET_NAMES.filter((name) => !seen.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[release-assets] release is missing ${missing.length} required asset(s): ${missing.join(", ")}`,
    );
  }

  for (const asset of assets) {
    if (asset.size <= 0) {
      throw new Error(`[release-assets] zero-byte required asset: ${asset.name}`);
    }
  }
}
