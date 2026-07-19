/**
 * Pure required-release-asset contract derived from RELEASE_BINARY_TARGETS + SHA256SUMS.
 *
 * Shared by:
 *   - scripts/verify-github-release-assets.ts (live gh release view)
 *   - apps/cli/test/unit/scripts/distribution-contract.test.ts (workflow lock)
 */

import { RELEASE_BINARY_TARGETS } from "../apps/cli/src/services/update/platform-assets";

export const REQUIRED_RELEASE_ASSET_NAMES = Object.freeze(
  [...RELEASE_BINARY_TARGETS.map((target) => target.out), "SHA256SUMS"].sort(),
);

export function assertRequiredReleaseAssets(actualNames: readonly string[]): void {
  const actual = new Set(actualNames);
  const missing = REQUIRED_RELEASE_ASSET_NAMES.filter((name) => !actual.has(name));
  if (missing.length > 0) {
    throw new Error(
      `[release-assets] release is missing ${missing.length} required asset(s): ${missing.join(", ")}`,
    );
  }
}
