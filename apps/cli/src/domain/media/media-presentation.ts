// =============================================================================
// media-presentation.ts — the single authority for how a piece of media names
// itself in product surfaces.
//
// Queue rows, the offline library, download filenames, notifications, the mpv
// display title and the download confirmation each used to carry their own
// "is this a movie?" branch. They disagreed: a movie downloaded with a synthetic
// season 1/episode 1 slot rendered as "S01E01" in some places and "Movie" in
// others, and anime rendered a meaningless "S01" prefix everywhere.
//
// This module owns that decision once. Callers pass what they stored; it
// answers what the user should see. Filesystem naming consumes
// `CanonicalMediaPosition` and only adds path-safe encoding — it never
// reinterprets content kind.
// =============================================================================

import type { MediaKind } from "@kunai/types";

export type CanonicalMediaPosition =
  | { readonly kind: "title" }
  | {
      readonly kind: "episode";
      readonly episode: number;
      readonly season?: number;
      /**
       * On output this means "the season is part of the canonical position and
       * should be rendered". Series set it for a defaulted season 1 by design,
       * because a series episode without a season still belongs to season 1.
       */
      readonly seasonIsMeaningful: boolean;
    };

export type MediaPresentationInput = {
  readonly title: string;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
  /**
   * Catalog structure. When `"movie"`, stored S1E1 slots stay internal even if
   * `mediaKind` is `"anime"` — theatrical films keep the anime badge, not an
   * episode code.
   */
  readonly contentType?: "movie" | "series";
  /**
   * Anime only. Callers set this when they can prove the season number came
   * from a real multi-season identity rather than a default slot.
   */
  readonly seasonIsMeaningful?: boolean;
};

export type MediaKindLabel = "Movie" | "Series" | "Anime" | "Video";
export type MediaItemNoun = "movie" | "episode" | "video";

export type MediaPresentation = {
  readonly title: string;
  readonly kindLabel: MediaKindLabel;
  readonly position: CanonicalMediaPosition;
  readonly positionLabel: string | null;
  readonly titleWithPosition: string;
  readonly itemNoun: MediaItemNoun;
};

type MediaKindPolicy = {
  readonly kindLabel: MediaKindLabel;
  readonly itemNoun: MediaItemNoun;
  readonly pluralNoun: `${MediaItemNoun}s`;
  /** Whether a stored episode can ever be product-visible for this kind. */
  readonly episodic: boolean;
  /** Whether season is shown by default when an episode is present. */
  readonly seasonByDefault: boolean;
};

const MEDIA_KIND_POLICY: Readonly<Record<MediaKind, MediaKindPolicy>> = {
  movie: {
    kindLabel: "Movie",
    itemNoun: "movie",
    pluralNoun: "movies",
    episodic: false,
    seasonByDefault: false,
  },
  series: {
    kindLabel: "Series",
    itemNoun: "episode",
    pluralNoun: "episodes",
    episodic: true,
    seasonByDefault: true,
  },
  anime: {
    kindLabel: "Anime",
    itemNoun: "episode",
    pluralNoun: "episodes",
    episodic: true,
    seasonByDefault: false,
  },
  video: {
    kindLabel: "Video",
    itemNoun: "video",
    pluralNoun: "videos",
    episodic: false,
    seasonByDefault: false,
  },
};

const TITLE_POSITION: CanonicalMediaPosition = { kind: "title" };

/** A position number is only real when it is a positive whole number. */
function normalizeOrdinal(value: number | undefined): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value <= 0) return undefined;
  return value;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatPositionLabel(position: CanonicalMediaPosition): string | null {
  if (position.kind === "title") return null;
  if (position.seasonIsMeaningful && position.season !== undefined) {
    return `S${pad2(position.season)}E${pad2(position.episode)}`;
  }
  return `E${pad2(position.episode)}`;
}

/**
 * Legacy SQLite rows can carry a `mediaKind` string the current union does not
 * cover. Such a row degrades to the title-level `video` policy rather than the
 * episodic `series` one: inventing an episode code for an unknown kind is the
 * exact failure this module exists to remove, and it would otherwise reach a
 * download filename.
 */
function resolveMediaKindPolicy(mediaKind: MediaKind): MediaKindPolicy {
  return MEDIA_KIND_POLICY[mediaKind] ?? MEDIA_KIND_POLICY.video;
}

/**
 * Narrow a persisted `mediaKind` column to the content-kind union.
 *
 * Some stores — the queue table, notification payloads — type this column as a
 * bare `string`. Casting at each call site would hide the moment an unknown
 * value appears; routing it through the same table makes the degradation one
 * explicit, testable decision.
 */
export function normalizeMediaKind(value: string | undefined): MediaKind {
  return value !== undefined && Object.hasOwn(MEDIA_KIND_POLICY, value)
    ? (value as MediaKind)
    : "video";
}

/**
 * The only in-scope authority that decides whether stored season/episode facts
 * are product-visible.
 */
export function presentMedia(input: MediaPresentationInput): MediaPresentation {
  const policy = resolveMediaKindPolicy(input.mediaKind);
  const episodic = policy.episodic && input.contentType !== "movie";
  const episode = episodic ? normalizeOrdinal(input.episode) : undefined;
  const season = normalizeOrdinal(input.season);

  let position: CanonicalMediaPosition = TITLE_POSITION;
  if (episode !== undefined) {
    if (policy.seasonByDefault) {
      // Series carry season identity even when the row only stored an episode.
      position = { kind: "episode", episode, season: season ?? 1, seasonIsMeaningful: true };
    } else if (input.seasonIsMeaningful === true && season !== undefined) {
      position = { kind: "episode", episode, season, seasonIsMeaningful: true };
    } else {
      position = { kind: "episode", episode, seasonIsMeaningful: false };
    }
  }

  const positionLabel = formatPositionLabel(position);
  return {
    title: input.title,
    kindLabel: policy.kindLabel,
    position,
    positionLabel,
    titleWithPosition: positionLabel === null ? input.title : `${input.title} ${positionLabel}`,
    itemNoun: policy.itemNoun,
  };
}

export function formatMediaItemCount(input: {
  readonly mediaKind: MediaKind;
  readonly count: number;
}): string {
  const policy = resolveMediaKindPolicy(input.mediaKind);
  const noun = input.count === 1 ? policy.itemNoun : policy.pluralNoun;
  return `${input.count} ${noun}`;
}
