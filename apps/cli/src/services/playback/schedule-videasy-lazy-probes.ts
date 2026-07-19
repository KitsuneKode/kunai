import type { Container } from "@/container";
import type { EpisodeInfo, ShellMode, StreamInfo, TitleInfo } from "@/domain/types";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import { VIDKING_PROVIDER_ID } from "@kunai/providers";
import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

export function scheduleVideasyLazySourceProbes(input: {
  readonly container: Container;
  readonly stream: StreamInfo;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: string;
  readonly signal?: AbortSignal;
  readonly onStreamUpdated?: (stream: StreamInfo) => void;
}): void {
  const result = input.stream.providerResolveResult;
  if (!result || result.providerId !== VIDKING_PROVIDER_ID) return;

  const resolveInput: ProviderResolveInput = streamRequestToResolveInput(
    {
      title: input.title,
      episode: input.episode,
      audioPreference: input.audioPreference,
      subtitlePreference: input.subtitlePreference,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority as ProviderResolveInput["startupPriority"],
    },
    input.mode,
    "play",
    "tmdb",
    input.providerId,
  );

  const context: ProviderRuntimeContext = {
    ...input.container.engine.createRuntimeContext(VIDKING_PROVIDER_ID, input.signal),
    retryPolicy: { maxAttempts: 1, backoff: "none", delayMs: 0 },
  };

  const inventoryKey = {
    providerId: input.providerId,
    mediaKind: resolveInput.mediaKind,
    titleId: input.title.id,
    season: input.episode.season,
    episode: input.episode.episode,
    audioMode: input.audioPreference,
    subtitleLanguage: input.subtitlePreference,
    qualityPreference: input.qualityPreference,
    startupPriority: input.startupPriority as ProviderResolveInput["startupPriority"],
  };

  input.container.videasyLazySourceProbe.schedulePhaseB({
    resolveInput,
    context,
    baseResult: result,
    inventoryKey,
    preferredAudioLanguage: input.audioPreference === "original" ? "en" : input.audioPreference,
    onInventoryUpdated: (inventory) => {
      input.onStreamUpdated?.({
        ...input.stream,
        providerResolveResult: inventory,
      });
    },
  });
}

export function scheduleVideasyLazySourceProbesFromContainer(
  container: Container,
  stream: StreamInfo,
  options?: {
    readonly signal?: AbortSignal;
    readonly onInventoryUpdated?: (stream: StreamInfo) => void;
  },
): void {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const episode = state.currentEpisode;
  if (!title || !episode || !stream.providerResolveResult) return;

  const config = container.config.getRaw();
  const mode = state.mode;
  const audioPreference =
    mode === "anime"
      ? config.animeLanguageProfile.audio
      : title.type === "movie"
        ? config.movieLanguageProfile.audio
        : config.seriesLanguageProfile.audio;
  const subtitlePreference =
    mode === "anime"
      ? config.animeLanguageProfile.subtitle
      : title.type === "movie"
        ? config.movieLanguageProfile.subtitle
        : config.seriesLanguageProfile.subtitle;
  const qualityPreference =
    mode === "anime"
      ? config.animeLanguageProfile.quality
      : title.type === "movie"
        ? config.movieLanguageProfile.quality
        : config.seriesLanguageProfile.quality;

  scheduleVideasyLazySourceProbes({
    container,
    stream,
    title,
    episode,
    mode,
    providerId: stream.providerResolveResult.providerId,
    audioPreference,
    subtitlePreference,
    qualityPreference,
    startupPriority: config.startupPriority,
    signal: options?.signal,
    onStreamUpdated: (nextStream) => {
      if (options?.onInventoryUpdated) {
        options.onInventoryUpdated(nextStream);
        return;
      }
      container.stateManager.dispatch({ type: "SET_STREAM", stream: nextStream });
    },
  });
}
