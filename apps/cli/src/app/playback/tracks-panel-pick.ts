import { applyUserProviderSwitch } from "@/app/playback/playback-provider-switch";
import { invalidateTitlePlaybackCaches } from "@/app/playback/playback-title-cache-invalidation";
import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import type { Container } from "@/container";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

export type TracksPanelPickContext = {
  readonly container: Container;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly currentProviderId: string;
  readonly resumeSeconds: number;
  readonly reason: string;
};

export type TracksPanelPickResult =
  | { readonly kind: "noop" }
  | { readonly kind: "provider-switch"; readonly providerId: string }
  | { readonly kind: "audio-mode-switch"; readonly audioMode: "sub" | "dub" }
  | {
      readonly kind: "cross-provider-source";
      readonly providerId: string;
      readonly sourceId: string;
    }
  | {
      readonly kind: "stream-selection";
      readonly section: DecodedTrackSelection["section"];
      readonly selection: StreamSelectionIntent;
    };

export type TrackPickTransitionContext = {
  readonly titleId: string;
  readonly season: number;
  readonly episode: number;
  readonly fromProvider?: string;
  readonly provider?: string;
  readonly sourceId?: string;
  readonly streamId?: string;
  readonly audioMode?: "sub" | "dub";
};

export function buildTrackPickTransitionContext(input: {
  readonly titleId: string;
  readonly episode: EpisodeInfo;
  readonly selection: StreamSelectionIntent;
  readonly fromProviderId: string;
}): TrackPickTransitionContext {
  const base = {
    titleId: input.titleId,
    season: input.episode.season,
    episode: input.episode.episode,
  };

  if (input.selection.crossProviderSource) {
    return {
      ...base,
      fromProvider: input.fromProviderId,
      provider: input.selection.crossProviderSource.providerId,
      sourceId: input.selection.crossProviderSource.sourceId,
    };
  }
  if (input.selection.providerId) {
    return {
      ...base,
      fromProvider: input.fromProviderId,
      provider: input.selection.providerId,
    };
  }
  if (input.selection.sourceId) return { ...base, sourceId: input.selection.sourceId };
  if (input.selection.streamId) return { ...base, streamId: input.selection.streamId };
  if (input.selection.audioMode) return { ...base, audioMode: input.selection.audioMode };
  return base;
}

export async function resolveTracksPanelPick(
  picked: DecodedTrackSelection,
  selection: StreamSelectionIntent | null,
  context: TracksPanelPickContext,
): Promise<TracksPanelPickResult> {
  const { container, title, episode, currentProviderId } = context;

  if (picked.section === "provider" && selection?.providerId) {
    if (selection.providerId === currentProviderId) {
      return { kind: "noop" };
    }
    await applyUserProviderSwitch({
      container,
      fromProviderId: currentProviderId,
      toProviderId: selection.providerId,
      title,
      episode,
      mode: container.stateManager.getState().mode,
    });
    container.diagnosticsService.record({
      category: "playback",
      operation: "playback.track-switch",
      message: "Provider switch from Tracks panel",
      providerId: selection.providerId,
      titleId: title.id,
      season: episode.season,
      episode: episode.episode,
      context: {
        section: picked.section,
        fromProviderId: currentProviderId,
        toProviderId: selection.providerId,
        reason: context.reason,
      },
    });
    return { kind: "provider-switch", providerId: selection.providerId };
  }

  if (picked.section === "audio" && selection?.audioMode) {
    const state = container.stateManager.getState();
    const nextProfile = {
      ...state.animeLanguageProfile,
      audio: selection.audioMode,
    };
    container.stateManager.dispatch({
      type: "UPDATE_LANGUAGE_PROFILE",
      kind: "anime",
      profile: nextProfile,
    });
    await container.config.update({ animeLanguageProfile: nextProfile });
    await container.config.save();
    await invalidateTitlePlaybackCaches({
      cacheStore: container.cacheStore,
      sourceInventory: container.sourceInventory,
      providerId: currentProviderId,
      title,
      mode: state.mode,
      config: container.config.getRaw(),
      episodes: [episode],
      cancelReason: "audio-mode-switch",
    });
    container.diagnosticsService.record({
      category: "playback",
      operation: "playback.track-switch",
      message: "Audio mode switch from Tracks panel",
      providerId: currentProviderId,
      titleId: title.id,
      season: episode.season,
      episode: episode.episode,
      context: {
        section: picked.section,
        audioMode: selection.audioMode,
        reason: context.reason,
      },
    });
    return { kind: "audio-mode-switch", audioMode: selection.audioMode };
  }

  if (selection?.crossProviderSource) {
    const { providerId, sourceId } = selection.crossProviderSource;
    await applyUserProviderSwitch({
      container,
      fromProviderId: currentProviderId,
      toProviderId: providerId,
      title,
      episode,
      mode: container.stateManager.getState().mode,
    });
    container.diagnosticsService.record({
      category: "playback",
      operation: "playback.track-switch",
      message: "Cross-provider source switch from Tracks panel",
      providerId,
      titleId: title.id,
      season: episode.season,
      episode: episode.episode,
      context: {
        section: picked.section,
        fromProviderId: currentProviderId,
        toProviderId: providerId,
        sourceId,
        reason: context.reason,
      },
    });
    return { kind: "cross-provider-source", providerId, sourceId };
  }

  if (!selection) {
    return { kind: "noop" };
  }

  return {
    kind: "stream-selection",
    section: picked.section,
    selection,
  };
}
