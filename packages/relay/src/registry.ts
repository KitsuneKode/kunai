import type { CoreProviderModule } from "@kunai/core";

import type { ProviderRelayRegistry, RelayProviderEntry, RelayableProviderManifest } from "./types";

export function buildProviderRelayRegistry(
  modules: readonly Pick<CoreProviderModule, "providerId" | "manifest">[],
): ProviderRelayRegistry {
  const providers: RelayProviderEntry[] = [];

  for (const module of modules) {
    const manifest = module.manifest as RelayableProviderManifest;
    if (!manifest.relayProfile) continue;
    providers.push({
      providerId: module.providerId,
      manifest,
      profile: manifest.relayProfile,
    });
  }

  return {
    providers,
    get(providerId) {
      return providers.find((entry) => entry.providerId === providerId);
    },
    findByUpstreamUrl(url) {
      const parsed = parseHttpUrl(url);
      if (!parsed) return undefined;
      return providers.find((entry) =>
        entry.profile.upstreamHosts.some((host) => hostMatches(parsed.hostname, host)),
      );
    },
    isHostAllowed(providerId, url, kind) {
      const parsed = parseHttpUrl(url);
      if (!parsed) return false;
      const entry = providers.find((candidate) => candidate.providerId === providerId);
      if (!entry) return false;
      const hosts =
        kind === "metadata" ? entry.profile.upstreamHosts : (entry.profile.videoRelayHosts ?? []);
      return hosts.some((host) => hostMatches(parsed.hostname, host));
    },
  };
}

export function hostMatches(hostname: string, allowedHost: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedAllowed = allowedHost.toLowerCase();
  return normalizedHost === normalizedAllowed || normalizedHost.endsWith(`.${normalizedAllowed}`);
}

export function parseHttpUrl(input: string | URL): URL | null {
  try {
    const url = input instanceof URL ? input : new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}
