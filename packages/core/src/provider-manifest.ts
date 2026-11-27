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

/**
 * An upstream fault a maintainer audit observed before this build shipped. It
 * is a dated claim, not live state: a published binary cannot learn that the
 * site recovered, so every reader must let newer local evidence outrank it.
 * Read by the provider picker (`resolveProviderPickerStatus` in the CLI).
 */
export interface ProviderKnownIssue {
  /** ISO date (`YYYY-MM-DD`) of the audit that observed the fault. */
  readonly since: string;
  /** One short user-facing clause, lower-case, no trailing period. */
  readonly summary: string;
}

export interface CoreProviderManifest {
  readonly id: ProviderId;
  readonly displayName: string;
  /**
   * Other names users know this site by. Never the shared engine family: a
   * name two providers both carry identifies neither of them.
   */
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly domain: string;
  readonly recommended: boolean;
  readonly mediaKinds: readonly MediaKind[];
  readonly capabilities: readonly ProviderCapability[];
  readonly runtimePorts: readonly ProviderRuntimePort[];
  readonly cachePolicy: CachePolicy;
  readonly browserSafe: boolean;
  /**
   * When true, this provider's metadata HTTP may be sent through `/rpc/{id}`
   * on a user-owned relay. This is never permission to proxy media.
   */
  readonly relaySafe: boolean;
  readonly relayProfile?: RelayProfile;
  /** When omitted, anime providers default to `anilist`; others default to `tmdb`. */
  readonly catalogIdentity?: ProviderCatalogIdentity;
  readonly knownIssue?: ProviderKnownIssue;
  readonly notes?: readonly string[];
}

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
