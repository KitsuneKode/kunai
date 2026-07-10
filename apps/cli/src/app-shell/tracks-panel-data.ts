import { buildSourceInventoryCacheInput } from "@/app/playback/playback-source-cache-invalidation";
import { buildStreamInventoryView } from "@/app/playback/source-quality";
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

/** Inventory older than this is still cache-valid but presented as aged/stale. */
export const CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * Stale presentation threshold: half of remaining inventory TTL when `expiresAt`
 * is known, floored to at least {@link CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS}.
 */
export function crossProviderInventoryStaleAfterMs(expiresAt?: string, nowMs = Date.now()): number {
  if (!expiresAt) return CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS;
  const ttl = Math.max(0, exp - nowMs);
  // Mark stale at half TTL, floored to at least 2 minutes.
  return Math.max(CROSS_PROVIDER_INVENTORY_STALE_AFTER_MS, Math.floor(ttl / 2));
}

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

export function formatCrossProviderCachedInventoryDetail(
  providerName: string,
  createdAt: string | undefined,
  nowMs = Date.now(),
  expiresAt?: string,
): string {
  const ageLabel = formatInventoryValidationAge(createdAt, nowMs);
  if (!ageLabel) return `${providerName} · cached`;
  if (isStaleInventoryAge(createdAt, nowMs, expiresAt)) {
    return `${providerName} · stale inventory · ${ageLabel}`;
  }
  return `${providerName} · cached ${ageLabel}`;
}

function formatInventoryValidationAge(
  createdAt: string | undefined,
  nowMs: number,
): string | undefined {
  if (!createdAt) return undefined;
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then) || then > nowMs) return undefined;
  const deltaMs = nowMs - then;
  const deltaMinutes = Math.max(0, Math.floor(deltaMs / 60_000));
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 48) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function isStaleInventoryAge(
  createdAt: string | undefined,
  nowMs: number,
  expiresAt?: string,
): boolean {
  if (!createdAt) return false;
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then)) return false;
  return nowMs - then >= crossProviderInventoryStaleAfterMs(expiresAt, nowMs);
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
  const nowMs = Date.now();
  for (const provider of compatible) {
    const cachedEntry = await container.sourceInventory.getEntry(
      buildSourceInventoryCacheInput(provider.id, title, episode, mode, config),
    );
    const sources = cachedEntry?.inventory?.sources;
    if (!cachedEntry || !sources?.length) continue;
    const cached = cachedEntry.inventory;
    const selected = cached.streams.find((candidate) => candidate.id === cached.selectedStreamId);
    const sourceId = selected?.sourceId ?? sources[0]?.id;
    if (!sourceId) continue;
    const source = sources.find((entry) => entry.id === sourceId);
    hintRows.push({
      section: "source",
      label: source?.label ?? sourceId,
      value: encodeCrossProviderSourceValue(provider.id, sourceId),
      selected: false,
      enabled: true,
      detail: formatCrossProviderCachedInventoryDetail(
        provider.name,
        cachedEntry.createdAt,
        nowMs,
        cachedEntry.expiresAt,
      ),
      risk: isStaleInventoryAge(cachedEntry.createdAt, nowMs, cachedEntry.expiresAt)
        ? "fallback"
        : "normal",
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
