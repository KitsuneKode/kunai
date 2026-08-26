import { withTimeoutSignal } from "@/infra/abort/timeout-signal";

import type { InstallMethodKind } from "./install-method";
import {
  fetchLatestVersion,
  type MetadataFetch,
  UPDATE_METADATA_TIMEOUT_MS,
} from "./latest-version";
import { fetchLatestKunaiVersion } from "./UpdateService";

/**
 * Single version-resolution entry point keyed by install channel.
 * Binary uses GitHub Releases; npm/bun use the npm registry (lockstep publish).
 */
export async function resolveLatestVersion(
  channel: InstallMethodKind,
  fetchImpl: MetadataFetch = fetch,
  signal: AbortSignal = withTimeoutSignal(undefined, UPDATE_METADATA_TIMEOUT_MS),
): Promise<string | null> {
  switch (channel) {
    case "binary":
      return fetchLatestVersion(fetchImpl, undefined, signal);
    case "npm-global":
    case "bun-global":
      try {
        return await fetchLatestKunaiVersion(fetchImpl, signal);
      } catch {
        return null;
      }
    default:
      return fetchLatestVersion(fetchImpl, undefined, signal);
  }
}
