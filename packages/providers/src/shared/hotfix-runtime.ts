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

/**
 * True when `url` targets an origin the active hotfix manifest introduced
 * (`baseUrl`, `mirrors`, or a URL-valued `cryptoOverrides` entry). Those are
 * HTTPS- and private-host-checked when the manifest is verified, but a redirect
 * from them is not, so `providerFetch` re-checks every hop for these origins.
 */
export function isHotfixSuppliedUrl(url: string): boolean {
  const manifest = getActiveProviderHotfixManifest();
  if (!manifest) return false;
  const origin = originOf(url);
  if (!origin) return false;
  for (const entry of Object.values(manifest.providers)) {
    const candidates = [
      entry.baseUrl,
      ...(entry.mirrors ?? []),
      ...Object.values(entry.cryptoOverrides ?? {}),
    ];
    for (const candidate of candidates) {
      if (candidate && originOf(candidate) === origin) return true;
    }
  }
  return false;
}

function originOf(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.origin.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/**
 * Thrown when an active hotfix marks every host of a provider dead. Falling
 * back to the bundled host there would send traffic to the exact server the
 * manifest retired, so the resolve/search fails fast (no network) and the
 * engine moves on to the next provider.
 */
export class ProviderHostsRetiredError extends Error {
  constructor(readonly providerId: string) {
    super(`${providerId}: every host is marked dead by the active provider hotfix`);
    this.name = "ProviderHostsRetiredError";
  }
}

/**
 * First effective host for a provider with a bundled default, honouring the
 * hotfix `baseUrl`/`mirrors`/`deadServers`. Throws `ProviderHostsRetiredError`
 * when nothing is left, instead of silently using a retired bundled host.
 */
export function requireEffectiveProviderHost(
  providerId: string,
  bundledHosts: readonly string[],
): string {
  const host = getEffectiveProviderMirrors(providerId, bundledHosts)[0];
  if (!host) throw new ProviderHostsRetiredError(providerId);
  return host;
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
