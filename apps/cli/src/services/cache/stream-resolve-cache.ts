// =============================================================================
// Stream resolve cache keys
//
// Single place for SQLite stream cache preimages used by playback and browser
// scrape paths so providers do not duplicate keying policy.
// =============================================================================

import type { TitleInfo, EpisodeInfo, ShellMode } from "@/domain/types";
import type { CoreProviderManifest } from "@kunai/core";
import type { StartupPriority } from "@kunai/types";

/** Preimage for API-style resolves (hashed by CacheStore implementation). */
export function buildApiStreamResolveCacheKey(input: {
  readonly providerId: string;
  readonly providerManifest?: CoreProviderManifest;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
}): string {
  const parts = buildManifestDrivenPolicyParts(input);
  return `api-resolve:${parts.join(":")}`;
}

/** Embed scrapes key the cache by canonical embed page URL (unchanged behavior). */
export function buildEmbedStreamCacheKey(embedPageUrl: string): string {
  return embedPageUrl;
}

function buildManifestDrivenPolicyParts(input: {
  readonly providerId: string;
  readonly providerManifest?: CoreProviderManifest;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
}): readonly string[] {
  const baseTokens = input.providerManifest?.cachePolicy.keyParts ?? [
    "provider",
    input.providerId,
    "media-kind",
    "title",
    "season",
    "episode",
    "audio",
    "subtitle",
    "quality",
    "startup",
    "source",
    "stream",
  ];

  return baseTokens.map((token) => resolveToken(token, input));
}

function resolveToken(
  token: string,
  input: {
    readonly providerId: string;
    readonly title: TitleInfo;
    readonly episode: EpisodeInfo;
    readonly mode: ShellMode;
    readonly audioPreference: string;
    readonly subtitlePreference: string;
    readonly qualityPreference?: string;
    readonly startupPriority?: StartupPriority;
    readonly selectedSourceId?: string;
    readonly selectedStreamId?: string;
  },
): string {
  switch (token) {
    case "provider":
      return "provider";
    case "media-kind":
    case "anime":
      return normalizePart(
        input.mode === "youtube" ? "video" : input.mode === "anime" ? "anime" : input.title.type,
      );
    case "title":
      return normalizePart(input.title.id);
    case "season":
      return normalizePart(input.episode.season);
    case "episode":
      return normalizePart(input.episode.episode);
    case "audio":
      return normalizePart(input.audioPreference);
    case "subtitle":
      return normalizePart(input.subtitlePreference);
    case "quality":
      return normalizePart(input.qualityPreference);
    case "startup":
      return normalizePart(input.startupPriority ?? "balanced");
    case "source":
      return normalizePart(input.selectedSourceId);
    case "stream":
      return normalizePart(input.selectedStreamId);
    default:
      return normalizePart(token);
  }
}

function normalizePart(value: string | number | undefined): string {
  if (value === undefined || value === "") {
    return "none";
  }
  return String(value).trim().toLowerCase().replaceAll(/\s+/g, "-");
}
