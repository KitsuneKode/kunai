import type {
  CachePolicy,
  MediaKind,
  ProviderCapability,
  ProviderId,
  ProviderRuntimePort,
  RelayProfile,
} from "@kunai/types";

/** How a provider keys titles for search, episode list, and stream resolve. */
export type ProviderCatalogIdentity = "provider-native" | "anilist" | "tmdb";

export interface CoreProviderManifest {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly domain: string;
  readonly recommended: boolean;
  readonly mediaKinds: readonly MediaKind[];
  readonly capabilities: readonly ProviderCapability[];
  readonly runtimePorts: readonly ProviderRuntimePort[];
  readonly cachePolicy: CachePolicy;
  readonly browserSafe: boolean;
  readonly relaySafe: boolean;
  readonly relayProfile?: RelayProfile;
  readonly status: ProviderManifestStatus;
  /** When omitted, anime providers default to `anilist`; others default to `tmdb`. */
  readonly catalogIdentity?: ProviderCatalogIdentity;
  readonly notes?: readonly string[];
}

export type ProviderManifestStatus = "production" | "candidate" | "experimental" | "research";

export function resolveProviderCatalogIdentity(
  manifest: Pick<CoreProviderManifest, "catalogIdentity" | "mediaKinds">,
): ProviderCatalogIdentity {
  if (manifest.catalogIdentity) return manifest.catalogIdentity;
  if (manifest.mediaKinds.includes("anime")) return "anilist";
  return "tmdb";
}

export function assertManifestHasRuntimePort(
  manifest: CoreProviderManifest,
  runtime: ProviderRuntimePort["runtime"],
): ProviderRuntimePort {
  const port = manifest.runtimePorts.find((candidate) => candidate.runtime === runtime);
  if (!port) {
    throw new Error(`${manifest.id} does not declare ${runtime} runtime support`);
  }

  return port;
}
