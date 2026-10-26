import { playbackQualityPreference } from "@/app/playback/playback-profile-context";
import { buildSourceInventoryCacheInput } from "@/app/playback/playback-source-cache-invalidation";
import { buildStreamInventoryView } from "@/app/playback/source-quality";
import type { Container } from "@/container";
import {
  buildProviderTrackCapabilities,
  type ProviderHealthHint,
} from "@/domain/playback/provider-track-capabilities";
import {
  QUALITY_AUTO_VALUE,
  buildTrackCapabilities,
  composeTrackPanelGroups,
  encodeCrossProviderSourceValue,
  type TrackCapability,
  type TrackCapabilityGroup,
} from "@/domain/playback/track-capabilities";
import { providerPickerLanesForTitle, shellModeToProviderLane } from "@/domain/provider-lane";
import { resolveTitleLaneEligibility } from "@/domain/provider-lane-contract";
import { sanitizeTerminalText } from "@/domain/text-display";
import type { EpisodeInfo, StreamInfo, TitleInfo } from "@/domain/types";
import { availableAudioModesFromTrace } from "@/services/playback/PlaybackSourceInventoryProjection";
import { resolveEffectiveProviderHealth } from "@/services/playback/provider-health-policy";

export type TracksPanelData = {
  readonly groups: readonly TrackCapabilityGroup[];
  readonly providerLabel: string;
};

function buildHealthHints(
  container: Container,
  titleId: string | undefined,
): Readonly<Record<string, ProviderHealthHint>> {
  const hints: Record<string, ProviderHealthHint> = {};
  for (const provider of container.providerRegistry.getAll()) {
    const suggestion = titleId
      ? container.titleProviderHealth.getSwitchSuggestion(titleId, provider.metadata.id)
      : undefined;
    const health = resolveEffectiveProviderHealth(
      container.providerHealth?.get(provider.metadata.id),
    );
    if (suggestion || health) {
      hints[provider.metadata.id] = {
        suggestedProviderId: suggestion?.suggestedProviderId,
        status: health?.effectiveStatus,
        consecutiveFailures: health?.healedByTtl ? undefined : health?.consecutiveFailures,
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
      buildSourceInventoryCacheInput(
        provider.id,
        title,
        episode,
        mode,
        config,
        state.playbackTrackPreferences,
      ),
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
  let inventoryGroups = buildTrackCapabilities(inventoryView, {
    mediaKind,
    availableAudioModes: audioModes.length > 0 ? audioModes : undefined,
    currentPresentation: currentPresentationFromStream(stream),
  });

  if (stream?.playbackSourceKind === "local") {
    return {
      providerLabel: "Local file",
      groups: [
        {
          section: "source",
          title: "Source",
          selectable: false,
          emptyReason:
            "Use player controls for downloaded audio and subtitles. Open the title online to change providers or sources.",
          rows: [
            {
              section: "source",
              label: "Downloaded file",
              value: "local-file",
              selected: true,
              enabled: false,
              reason: "Validated local file",
              detail: "Tracks: player controls",
              risk: "normal",
            },
          ],
        },
        ...inventoryGroups
          .filter((group) => group.section !== "source")
          .map((group) => ({
            ...group,
            selectable: false,
            emptyReason:
              "Use player controls for downloaded audio and subtitles. Open the title online to change providers or sources.",
            rows: group.rows.map((row) => ({
              ...row,
              enabled: false,
              reason: "Downloaded file; use player controls",
            })),
          })),
      ],
    };
  }

  const liveSubtitle = stream?.playbackSubtitle;
  if (liveSubtitle) {
    const playing = liveSubtitle.id > 0 && liveSubtitle.visible;
    if (!inventoryGroups.some((group) => group.section === "subtitle")) {
      inventoryGroups = [
        ...inventoryGroups,
        { section: "subtitle", title: "Subtitles", rows: [], selectable: false },
      ];
    }
    inventoryGroups = inventoryGroups.map((group) =>
      group.section !== "subtitle"
        ? group
        : {
            ...group,
            selectable: true,
            rows: [
              {
                section: "subtitle" as const,
                label: "Subtitles off",
                value: "subtitle:off",
                selected: liveSubtitle.id === 0,
                enabled: liveSubtitle.id > 0,
                risk: "normal" as const,
              },
              ...group.rows
                .filter((row) => row.value !== "subtitle:off")
                .map((row) => ({ ...row, selected: false, enabled: row.enabled || row.selected })),
              ...(liveSubtitle.id > 0
                ? [
                    {
                      section: "subtitle" as const,
                      label: sanitizeTerminalText(
                        `${playing ? "" : "Hidden · "}${liveSubtitle.title || liveSubtitle.language || "mpv subtitle"}`,
                      ),
                      value: `mpv-subtitle:${liveSubtitle.id}`,
                      selected: true,
                      enabled: false,
                      reason: "Selected in mpv",
                      risk: "normal" as const,
                    },
                  ]
                : []),
            ],
          },
    );
  }

  const preference = playbackQualityPreference({
    mode: state.mode,
    title: state.currentTitle,
    config: container.config.getRaw(),
    overrides: state.playbackTrackPreferences,
  });
  const automatic = !preference || preference === "auto" || preference === "best";
  inventoryGroups = inventoryGroups.map((group) => {
    if (group.section !== "quality" || group.rows.length === 0) return group;
    const current = group.rows.find((row) => row.selected);
    if (group.rows.length === 1) {
      const only = group.rows[0];
      if (!only) return group;
      const knownQuality = /\d{3,4}p|4k|8k/i.test(only.label);
      return {
        ...group,
        selectable: !automatic,
        emptyReason: "No alternate quality reported by this source",
        rows: [
          {
            ...only,
            label: "Auto",
            value: QUALITY_AUTO_VALUE,
            selected: automatic,
            enabled: !automatic,
            detail: knownQuality
              ? `${only.label} · only reported quality`
              : "Quality chosen by the stream",
            reason: automatic ? "No alternate quality reported by this source" : undefined,
          },
        ],
      };
    }
    return {
      ...group,
      selectable: true,
      rows: [
        {
          section: "quality" as const,
          label: "Auto",
          value: QUALITY_AUTO_VALUE,
          selected: automatic,
          enabled: !automatic,
          detail: current
            ? `Currently ${current.label} · Best available`
            : "Best available from this source",
          risk: "normal" as const,
        },
        ...group.rows.map((row) => ({
          ...row,
          selected: automatic ? false : row.selected,
          enabled: automatic && row.selected ? true : row.enabled,
        })),
      ],
    };
  });

  const providers = container.providerRegistry.getAll().map((provider) => provider.metadata);
  // Same eligibility as the provider picker: a linked title can switch into
  // the other lane's providers, and the playing provider is always listed.
  const tracksLanes = providerPickerLanesForTitle(
    shellModeToProviderLane(state.mode),
    state.currentTitle ? resolveTitleLaneEligibility(state.currentTitle) : null,
  );
  const providerGroup = buildProviderTrackCapabilities({
    providers,
    mode: state.mode,
    lanes: tracksLanes,
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
