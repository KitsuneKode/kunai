import {
  mergeProviderMirrors,
  resolveProviderHotfixEntry,
  type ProviderHotfixEntry,
  type ProviderHotfixManifest,
} from "./manifest-bundle";

let activeHotfixManifest: ProviderHotfixManifest | null = null;

/**
 * Installs a verified Tier-1 provider hotfix manifest for the current process.
 * Callers must pass only manifests verified by `verifySignedProviderManifest`,
 * or `null` to reset to bundled defaults.
 */
export function setActiveProviderHotfixManifest(manifest: ProviderHotfixManifest | null): void {
  activeHotfixManifest = manifest;
}

export function getActiveProviderHotfixManifest(
  nowMs: number = Date.now(),
): ProviderHotfixManifest | null {
  if (!activeHotfixManifest) return null;
  const expiresAtMs = Date.parse(activeHotfixManifest.expiresAt);
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    activeHotfixManifest = null;
    return null;
  }
  return activeHotfixManifest;
}

export function getProviderHotfixEntry(providerId: string): ProviderHotfixEntry | null {
  return resolveProviderHotfixEntry(getActiveProviderHotfixManifest(), providerId);
}

/**
 * Resolves effective ordered HTTPS endpoints for a provider, applying active
 * hotfix `baseUrl` / `mirrors` ahead of bundled hosts and stripping `deadServers`.
 */
export function getEffectiveProviderMirrors(
  providerId: string,
  bundledMirrors: readonly string[],
): readonly string[] {
  return mergeProviderMirrors(bundledMirrors, getProviderHotfixEntry(providerId));
}

export function getProviderCryptoOverride(
  providerId: string,
  key: string,
  fallback: string,
): string {
  const overrides = getProviderHotfixEntry(providerId)?.cryptoOverrides;
  if (!overrides || !Object.hasOwn(overrides, key)) return fallback;
  const value = overrides[key];
  return value && value.length > 0 ? value : fallback;
}
