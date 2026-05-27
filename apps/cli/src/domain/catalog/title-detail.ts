// =============================================================================
// Title detail — shared catalog metadata + artwork contract
//
// The single view-model produced by the metadata/artwork service (Agent ART)
// and consumed by the Details sheet, post-play, episode, and browse rails.
//
// Pure types + a pure, tested artwork-merge policy. No I/O, no UI, no provider
// SDK imports — services map TMDB / AniList / TVDB responses INTO these shapes;
// surfaces only render them. This keeps "best-of-provider" selection a single
// testable source of truth instead of ad-hoc picking scattered across surfaces.
// =============================================================================

import type { ContentType } from "@/domain/types";
import type { ProviderExternalIds } from "@kunai/types";

/** Metadata/artwork origins, in the order they are typically merged. */
export type MetadataSource = "tmdb" | "anilist" | "tvdb" | "provider";

export type TitleStatus = "released" | "upcoming" | "airing" | "unknown";

export type CastKind = "actor" | "voice";

export interface CastMember {
  readonly name: string;
  /** Character name, or "as X" / role label. */
  readonly role?: string;
  readonly kind: CastKind;
  readonly photoUrl?: string;
}

export interface SeasonSummary {
  readonly season: number;
  readonly name?: string;
  readonly episodeCount?: number;
  readonly year?: string;
  readonly posterUrl?: string;
}

/**
 * Best-of-provider artwork. `seasonPosters` is keyed by season number;
 * `episodeThumbnails` by {@link episodeThumbKey}. Both are merged per-key so a
 * single missing season/episode from the preferred source is back-filled from
 * another, rather than dropping the whole map.
 */
export interface ArtworkSet {
  readonly poster?: string;
  readonly backdrop?: string;
  readonly seasonPosters?: Readonly<Record<number, string>>;
  readonly episodeThumbnails?: Readonly<Record<string, string>>;
  /** Which sources actually contributed any image (provenance, for diagnostics). */
  readonly contributingSources?: readonly MetadataSource[];
}

/** One source's raw artwork offering, fed into {@link mergeArtwork}. */
export interface ArtworkCandidate {
  readonly source: MetadataSource;
  readonly poster?: string;
  readonly backdrop?: string;
  readonly seasonPosters?: Readonly<Record<number, string>>;
  readonly episodeThumbnails?: Readonly<Record<string, string>>;
}

/**
 * The canonical title detail. Every field is optional: surfaces show what is
 * present and render an honest placeholder for what is not — never a hang.
 */
export interface TitleDetail {
  readonly id: string;
  readonly type: ContentType;
  readonly title: string;
  readonly year?: string;
  readonly synopsis?: string;
  readonly genres?: readonly string[];
  readonly studios?: readonly string[];
  readonly runtimeMinutes?: number;
  /** Certification, e.g. "U/A 16+", "TV-MA". */
  readonly contentRating?: string;
  readonly releaseDate?: string;
  readonly status?: TitleStatus;
  readonly seasonCount?: number;
  readonly episodeCount?: number;
  readonly seasons?: readonly SeasonSummary[];
  readonly cast?: readonly CastMember[];
  readonly artwork?: ArtworkSet;
  readonly externalIds?: ProviderExternalIds;
  /** Which sources contributed any field (provenance). */
  readonly sources?: readonly MetadataSource[];
}

/**
 * Default merge preference per content kind. Anime key art is usually best on
 * AniList; live-action posters are usually best on TMDB. `provider` art is the
 * last resort (often low-res stills). Callers may override.
 */
export const ARTWORK_PREFERENCE: Readonly<
  Record<"anime" | "series" | "movie", readonly MetadataSource[]>
> = {
  anime: ["anilist", "tmdb", "tvdb", "provider"],
  series: ["tmdb", "tvdb", "anilist", "provider"],
  movie: ["tmdb", "tvdb", "anilist", "provider"],
};

/** Stable key for an episode thumbnail within {@link ArtworkSet.episodeThumbnails}. */
export function episodeThumbKey(season: number, episode: number): string {
  return `${season}.${episode}`;
}

function rankBy(preference: readonly MetadataSource[]): (candidate: ArtworkCandidate) => number {
  const rank = new Map<MetadataSource, number>(preference.map((source, index) => [source, index]));
  return (candidate) => rank.get(candidate.source) ?? Number.MAX_SAFE_INTEGER;
}

function firstNonEmpty(
  ordered: readonly ArtworkCandidate[],
  pick: (candidate: ArtworkCandidate) => string | undefined,
): string | undefined {
  for (const candidate of ordered) {
    const value = pick(candidate);
    if (value) return value;
  }
  return undefined;
}

function mergeKeyed(
  ordered: readonly ArtworkCandidate[],
  pick: (candidate: ArtworkCandidate) => Readonly<Record<string | number, string>> | undefined,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let hasAny = false;
  // Walk least→most preferred so a more-preferred source overwrites per key,
  // while less-preferred sources still back-fill keys the others lack.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const candidate = ordered[i];
    if (!candidate) continue;
    const map = pick(candidate);
    if (!map) continue;
    for (const key of Object.keys(map)) {
      const value = map[key];
      if (value) {
        out[key] = value;
        hasAny = true;
      }
    }
  }
  return hasAny ? out : undefined;
}

/**
 * Merge artwork candidates into one {@link ArtworkSet} using a source
 * preference order. Scalars take the first non-empty value in preference order;
 * keyed maps (season posters, episode thumbnails) merge per-key with preferred
 * sources winning and others back-filling. Pure and order-stable.
 */
export function mergeArtwork(
  candidates: readonly ArtworkCandidate[],
  preference: readonly MetadataSource[] = ARTWORK_PREFERENCE.series,
): ArtworkSet {
  const ordered = [...candidates].sort((a, b) => rankBy(preference)(a) - rankBy(preference)(b));

  const seasonPosters = mergeKeyed(ordered, (c) => c.seasonPosters);
  const episodeThumbnails = mergeKeyed(ordered, (c) => c.episodeThumbnails);
  const contributingSources = ordered
    .filter((c) => c.poster || c.backdrop || c.seasonPosters || c.episodeThumbnails)
    .map((c) => c.source);

  return {
    poster: firstNonEmpty(ordered, (c) => c.poster),
    backdrop: firstNonEmpty(ordered, (c) => c.backdrop),
    ...(seasonPosters ? { seasonPosters } : {}),
    ...(episodeThumbnails ? { episodeThumbnails } : {}),
    ...(contributingSources.length ? { contributingSources } : {}),
  };
}
