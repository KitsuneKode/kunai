import { applyUserProviderSwitch } from "@/app/playback/playback-provider-switch";
import type { Container } from "@/container";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";

export type FallbackProviderCandidate = {
  readonly metadata: {
    readonly id: string;
  };
};

export function pickCompatibleFallbackProvider(
  providers: readonly FallbackProviderCandidate[],
  currentProviderId: string,
): FallbackProviderCandidate | undefined {
  return providers.find((candidate) => candidate.metadata.id !== currentProviderId);
}

export async function switchPlaybackProviderFallback(input: {
  readonly container: Container;
  readonly fromProviderId: string;
  readonly toProviderId: string;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly invalidateRecentEpisodeStream: (episode: EpisodeInfo) => void;
}): Promise<{ readonly fromProviderId: string; readonly providerId: string }> {
  await applyUserProviderSwitch({
    container: input.container,
    fromProviderId: input.fromProviderId,
    toProviderId: input.toProviderId,
    title: input.title,
    episode: input.episode,
    mode: input.mode,
  });
  input.invalidateRecentEpisodeStream(input.episode);
  return {
    fromProviderId: input.fromProviderId,
    providerId: input.toProviderId,
  };
}
