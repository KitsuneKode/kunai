import type { MediaKind, ProviderExternalIds } from "@kunai/types";

export interface MediaProviderHint {
  readonly providerId: string;
  readonly sourceId?: string;
  readonly qualityLabel?: string;
}

export interface MediaItemIdentity {
  readonly mediaKind: MediaKind;
  readonly sourceId?: string;
  readonly titleId: string;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly providerHints?: readonly MediaProviderHint[];
  /**
   * Cross-catalogue ids, when the producing surface knew them.
   *
   * Tracker sync addresses AniList by `anilistId` and TMDB by `tmdbId`; a
   * `titleId` alone only resolves when it happens to carry the matching
   * namespace. Dropping this field is why favouriting an anime row wrote the
   * local list and queued nothing — every resolver returned null and the
   * enqueue reported zero rows to a caller that ignored the count.
   */
  readonly externalIds?: ProviderExternalIds;
}

export function getMediaItemKey(item: MediaItemIdentity): string {
  return [
    item.mediaKind,
    item.sourceId ?? "unknown",
    item.titleId,
    item.season ?? "-",
    item.episode ?? item.absoluteEpisode ?? "-",
  ].join(":");
}

/**
 * The fields shared by a media identity and a persisted queue entry.
 *
 * `mediaKind` stays a bare string here: queue rows carry whatever the column
 * holds, and both sides of a membership check must key on the same raw value
 * for the comparison to mean anything.
 */
export type EpisodeIdentity = Pick<
  MediaItemIdentity,
  "titleId" | "season" | "episode" | "absoluteEpisode"
> & { readonly mediaKind: string };

/**
 * "Which episode is this", independent of where it would be played from.
 *
 * Deliberately NOT `getMediaItemKey`: that one includes `sourceId`, and queue
 * rows do not persist it (`enqueueMediaItem` drops it), so comparing the two
 * through that key reports a miss whenever the other side knows its source.
 * Provider choice does not change which episode something is, so membership
 * questions — "is this already queued?" — must ignore it.
 */
export function getEpisodeIdentityKey(item: EpisodeIdentity): string {
  return [
    item.mediaKind,
    item.titleId,
    item.season ?? "-",
    item.episode ?? item.absoluteEpisode ?? "-",
  ].join(":");
}

export function sanitizeProviderHints(
  hints: readonly (MediaProviderHint | (MediaProviderHint & Record<string, unknown>))[] | undefined,
): readonly MediaProviderHint[] {
  return (hints ?? []).map((hint) => ({
    providerId: hint.providerId,
    sourceId: hint.sourceId,
    qualityLabel: hint.qualityLabel,
  }));
}
