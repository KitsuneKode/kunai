import { applyUserProviderSwitch } from "@/app/playback/playback-provider-switch";
import { buildSourceInventoryCacheInput } from "@/app/playback/playback-source-cache-invalidation";
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
  readonly playbackSourceKind?: "local" | "provider";
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
    }
  | {
      readonly kind: "stale-pick";
      readonly section: DecodedTrackSelection["section"];
      readonly reason: string;
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
  if (
    context.playbackSourceKind === "local" ||
    container.stateManager.getState().stream?.playbackSourceKind === "local" ||
    title.launchSource === "offline-library"
  ) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Use player controls for downloaded tracks. Open the title online to change providers or sources.",
    });
    return { kind: "noop" };
  }

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

  // The panel rows were built from an inventory snapshot; a re-resolve or
  // provider switch between render and pick leaves ids that no longer exist.
  // Applying blindly keeps playing the old stream while reporting success, so
  // validate against the cached inventory and say so instead.
  if (selection.streamId ?? selection.sourceId) {
    const stale = await staleTrackSelectionReason(selection, context);
    if (stale) return { kind: "stale-pick", section: picked.section, reason: stale };
  }

  return {
    kind: "stream-selection",
    section: picked.section,
    selection,
  };
}

/**
 * Null when the pick still names a live stream/source in the cached
 * inventory, otherwise a human-readable reason. A missing cache row is not
 * staleness — without inventory there is nothing to contradict the pick, and
 * the apply path re-resolves from the provider.
 */
async function staleTrackSelectionReason(
  selection: StreamSelectionIntent,
  context: TracksPanelPickContext,
): Promise<string | null> {
  const { container, title, episode, currentProviderId } = context;
  const mode = container.stateManager.getState().mode;
  const cached = await container.sourceInventory
    .get(
      buildSourceInventoryCacheInput(
        currentProviderId,
        title,
        episode,
        mode,
        container.config.getRaw(),
      ),
    )
    .catch(() => null);
  return matchTrackSelectionAgainstInventory(selection, cached);
}

/**
 * Pure half of stale-pick detection, exported for tests: the fetch above is
 * the only impure step, and the decision must be unit-coverable without a
 * container stub.
 */
export function matchTrackSelectionAgainstInventory(
  selection: StreamSelectionIntent,
  inventory: {
    readonly streams?: readonly { readonly id: string; readonly sourceId?: string }[];
  } | null,
): string | null {
  if (!inventory || !Array.isArray(inventory.streams)) return null;
  if (
    selection.streamId &&
    !inventory.streams.some((candidate) => candidate.id === selection.streamId)
  ) {
    return "That stream is no longer available — the source list changed. Pick again from the refreshed list.";
  }
  if (
    selection.sourceId &&
    !inventory.streams.some((candidate) => candidate.sourceId === selection.sourceId)
  ) {
    return "That source is no longer available — the source list changed. Pick again from the refreshed list.";
  }
  return null;
}
