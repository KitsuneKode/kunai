// =============================================================================
// Stream resolve cache keys
//
// Single place for SQLite stream cache preimages used by playback and browser
// scrape paths so providers do not duplicate keying policy.
// =============================================================================

import type { TitleInfo, EpisodeInfo } from "@/domain/types";
import type { CoreProviderManifest } from "@kunai/core";

/** Preimage for API-style resolves (hashed by CacheStore implementation). */
export function buildApiStreamResolveCacheKey(input: {
  readonly providerId: string;
  readonly providerManifest?: CoreProviderManifest;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: "series" | "anime";
  readonly subLang: string;
  readonly animeLang: "sub" | "dub";
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
  readonly mode: "series" | "anime";
  readonly subLang: string;
  readonly animeLang: "sub" | "dub";
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
  ];

  return baseTokens.map((token) => resolveToken(token, input));
}

function resolveToken(
  token: string,
  input: {
    readonly providerId: string;
    readonly title: TitleInfo;
    readonly episode: EpisodeInfo;
    readonly mode: "series" | "anime";
    readonly subLang: string;
    readonly animeLang: "sub" | "dub";
  },
): string {
  switch (token) {
    case "provider":
      return "provider";
    case "media-kind":
    case "anime":
      return normalizePart(input.mode === "anime" ? "anime" : input.title.type);
    case "title":
      return normalizePart(input.title.id);
    case "season":
      return normalizePart(input.episode.season);
    case "episode":
      return normalizePart(input.episode.episode);
    case "audio":
      return normalizePart(input.animeLang);
    case "subtitle":
      return normalizePart(input.subLang);
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
