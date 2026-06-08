export type ResolvedStreamSelection = {
  readonly sourceId: string | null;
  readonly streamId: string | null;
};

export type PlaybackSelectionLayers = {
  readonly episode?: ResolvedStreamSelection | null;
  readonly titleSourceId?: string | null;
};

export function emptyResolvedStreamSelection(): ResolvedStreamSelection {
  return { sourceId: null, streamId: null };
}

/**
 * Merge per-episode and per-title source preferences.
 * Episode wins when it carries sourceId or streamId; title supplies sourceId only.
 */
export function resolveEffectiveStreamSelection(
  layers: PlaybackSelectionLayers,
): ResolvedStreamSelection {
  const episode = layers.episode;
  if (episode?.sourceId || episode?.streamId) {
    return {
      sourceId: episode.sourceId ?? null,
      streamId: episode.streamId ?? null,
    };
  }
  const titleSourceId = layers.titleSourceId?.trim();
  if (titleSourceId) {
    return { sourceId: titleSourceId, streamId: null };
  }
  return emptyResolvedStreamSelection();
}
