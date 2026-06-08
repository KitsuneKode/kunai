import { buildSourceInventoryCacheInput } from "@/app/playback-source-cache-invalidation";
import { buildStreamInventoryView } from "@/app/source-quality";
import type { Container } from "@/container";
import {
  buildProviderTrackCapabilities,
  type ProviderHealthHint,
} from "@/domain/playback/provider-track-capabilities";
import {
  buildTrackCapabilities,
  composeTrackPanelGroups,
  encodeCrossProviderSourceValue,
  type TrackCapability,
  type TrackCapabilityGroup,
} from "@/domain/playback/track-capabilities";
import type { EpisodeInfo, StreamInfo, TitleInfo } from "@/domain/types";
import { availableAudioModesFromTrace } from "@/services/playback/PlaybackSourceInventoryProjection";

export type TracksPanelData = {
  readonly groups: readonly TrackCapabilityGroup[];
  readonly providerLabel: string;
};

function buildHealthHints(
  container: Container,
  titleId: string | undefined,
): Readonly<Record<string, ProviderHealthHint>> {
  if (!titleId) return {};
  const hints: Record<string, ProviderHealthHint> = {};
  for (const provider of container.providerRegistry.getAll()) {
    const suggestion = container.titleProviderHealth.getSwitchSuggestion(
      titleId,
      provider.metadata.id,
    );
    if (suggestion) {
      hints[provider.metadata.id] = {
        suggestedProviderId: suggestion.suggestedProviderId,
      };
    }
  }
  return hints;
}

function currentPresentationFromStream(
  stream: StreamInfo | null,
): "sub" | "dub" | "raw" | undefined {
  const result = stream?.providerResolveResult;
  if (!result) return undefined;
  const selected = result.streams.find((candidate) => candidate.id === result.selectedStreamId);
  return selected?.presentation;
}

async function appendCrossProviderSourceHints(
  groups: readonly TrackCapabilityGroup[],
  stream: StreamInfo | null,
  container: Container,
  title: TitleInfo | undefined,
  episode: EpisodeInfo | undefined,
): Promise<readonly TrackCapabilityGroup[]> {
  const result = stream?.providerResolveResult;
  if (!result || !title || !episode) return groups;

  const state = container.stateManager.getState();
  const mode = state.mode;
  const config = container.config.getRaw();
  const activeProviderId = result.providerId;
  const compatible = container.providerRegistry
    .getCompatible(title, mode)
    .map((provider) => provider.metadata)
    .filter((provider) => provider.id !== activeProviderId);

  if (compatible.length === 0) return groups;

  const hintRows: TrackCapability[] = [];
  for (const provider of compatible) {
    const cached = await container.sourceInventory.get(
      buildSourceInventoryCacheInput(provider.id, title, episode, mode, config),
    );
    if (!cached?.sources?.length) continue;
    const selected = cached.streams.find((candidate) => candidate.id === cached.selectedStreamId);
    const sourceId = selected?.sourceId ?? cached.sources[0]?.id;
    if (!sourceId) continue;
    const source = cached.sources.find((entry) => entry.id === sourceId);
    hintRows.push({
      section: "source",
      label: source?.label ?? sourceId,
      value: encodeCrossProviderSourceValue(provider.id, sourceId),
      selected: false,
      enabled: true,
      detail: `${provider.name} · cached`,
      risk: "normal",
    });
  }

  if (hintRows.length === 0) return groups;

  return groups.map((group) =>
    group.section === "source"
      ? {
          ...group,
          rows: [...group.rows, ...hintRows],
          selectable: group.selectable || hintRows.some((row) => row.enabled),
        }
      : group,
  );
}

export async function buildTracksPanelData(
  stream: StreamInfo | null,
  container: Container,
): Promise<TracksPanelData> {
  const state = container.stateManager.getState();
  const result = stream?.providerResolveResult;
  const mediaKind =
    result?.trace.title.kind ?? (state.mode === "anime" ? "anime" : state.currentTitle?.type);
  const inventoryView = buildStreamInventoryView(stream);
  const audioModes = result ? availableAudioModesFromTrace(result) : [];
  const inventoryGroups = buildTrackCapabilities(inventoryView, {
    mediaKind,
    availableAudioModes: audioModes.length > 0 ? audioModes : undefined,
    currentPresentation: currentPresentationFromStream(stream),
  });

  const providers = container.providerRegistry.getAll().map((provider) => provider.metadata);
  const providerGroup = buildProviderTrackCapabilities({
    providers,
    mode: state.mode === "anime" ? "anime" : "series",
    currentProviderId: result?.providerId ?? state.provider,
    healthByProviderId: buildHealthHints(container, state.currentTitle?.id),
  });

  let groups = composeTrackPanelGroups(providerGroup, inventoryGroups, mediaKind);
  groups = await appendCrossProviderSourceHints(
    groups,
    stream,
    container,
    state.currentTitle ?? undefined,
    state.currentEpisode ?? undefined,
  );

  const providerLabel =
    container.providerRegistry.get(result?.providerId ?? state.provider)?.metadata.name ??
    result?.providerId ??
    state.provider;

  return { groups, providerLabel };
}
