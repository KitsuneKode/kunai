import type { MediaKind, ProviderExternalIds } from "@kunai/types";

export type TrackerId = "anilist" | "tmdb";

/**
 * A tracker-native address. Each variant carries the id in the catalogue that
 * owns it, so a value can never be handed to the wrong tracker: there is no
 * shared `id: number` field to pass along by accident.
 */
export type SyncIdentity =
  | {
      readonly tracker: "anilist";
      readonly anilistId: number;
      readonly mediaKind: "anime";
    }
  | {
      readonly tracker: "tmdb";
      readonly tmdbId: number;
      readonly mediaKind: "movie" | "series";
    };

/** What a Kunai title knows about itself, before any tracker interprets it. */
export interface TrackerIdSource {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly externalIds?: ProviderExternalIds;
}

/**
 * What a tracker can actually do, as declared by the adapter that implements
 * it. Settings and operation gating read these rather than restating them, so
 * a capability cannot be advertised in one place and unimplemented in another.
 */
export interface SyncCapabilities {
  readonly episodeProgress: boolean;
  readonly watchlistMembership: boolean;
  readonly favoriteMembership: boolean;
  readonly pullLists: boolean;
  readonly rating: boolean;
}
