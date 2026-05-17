export type MediaKind = "movie" | "series" | "anime";

export interface MediaProviderHint {
  readonly providerId: string;
  readonly sourceId?: string;
  readonly qualityLabel?: string;
}

export interface MediaItemIdentity {
  readonly mediaKind: MediaKind | string;
  readonly sourceId?: string;
  readonly titleId: string;
  readonly title: string;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly providerHints?: readonly MediaProviderHint[];
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

export function sanitizeProviderHints(
  hints: readonly (MediaProviderHint | (MediaProviderHint & Record<string, unknown>))[] | undefined,
): readonly MediaProviderHint[] {
  return (hints ?? []).map((hint) => ({
    providerId: hint.providerId,
    sourceId: hint.sourceId,
    qualityLabel: hint.qualityLabel,
  }));
}
