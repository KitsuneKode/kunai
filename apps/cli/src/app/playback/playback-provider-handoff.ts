export interface PlaybackProviderHandoff {
  readonly configuredProviderId: string;
  readonly successfulProviderId: string;
  readonly historyProviderId: string;
  readonly presenceProviderId: string;
  readonly shareProviderId: string;
  readonly nextEpisodeProviderId: string;
}

export function resolvePlaybackProviderHandoff(input: {
  readonly configuredProviderId: string;
  readonly successfulProviderId: string;
}): PlaybackProviderHandoff {
  const { configuredProviderId, successfulProviderId } = input;
  return {
    configuredProviderId,
    successfulProviderId,
    historyProviderId: successfulProviderId,
    presenceProviderId: successfulProviderId,
    shareProviderId: successfulProviderId,
    nextEpisodeProviderId: successfulProviderId,
  };
}
