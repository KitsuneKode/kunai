import type { InstallMethodKind } from "./install-method";
import { fetchLatestVersion } from "./latest-version";
import { fetchLatestKunaiVersion } from "./UpdateService";

/**
 * Single version-resolution entry point keyed by install channel.
 * Binary uses GitHub Releases; npm/bun use the npm registry (lockstep publish).
 */
export async function resolveLatestVersion(
  channel: InstallMethodKind,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  switch (channel) {
    case "binary":
      return fetchLatestVersion(fetchImpl);
    case "npm-global":
    case "bun-global":
      try {
        return await fetchLatestKunaiVersion();
      } catch {
        return null;
      }
    default:
      return fetchLatestVersion(fetchImpl);
  }
}
