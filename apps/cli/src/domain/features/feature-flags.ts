export interface AttentionFeatureFlags {
  readonly attentionInbox: boolean;
  readonly queueRecovery: boolean;
  readonly playlistSharing: boolean;
  readonly newEpisodeProjection: boolean;
  readonly providerAvailabilitySync: boolean;
}

export interface ResolveAttentionFeatureFlagsOptions {
  readonly env?: Record<string, string | undefined>;
  readonly overrides?: Partial<AttentionFeatureFlags>;
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function resolveAttentionFeatureFlags(
  options: ResolveAttentionFeatureFlagsOptions = {},
): AttentionFeatureFlags {
  const env = options.env ?? process.env;
  const envAvailabilitySync = readBoolean(env.KUNAI_EXPERIMENTAL_PROVIDER_AVAILABILITY_SYNC);
  const envPlaylistSharing = readBoolean(env.KUNAI_PLAYLIST_SHARING);

  return {
    attentionInbox: options.overrides?.attentionInbox ?? true,
    queueRecovery: options.overrides?.queueRecovery ?? true,
    playlistSharing: options.overrides?.playlistSharing ?? envPlaylistSharing ?? false,
    newEpisodeProjection: options.overrides?.newEpisodeProjection ?? true,
    providerAvailabilitySync:
      options.overrides?.providerAvailabilitySync ?? envAvailabilitySync ?? false,
  };
}
