// =============================================================================
// select-heal-targets.ts — pure selection of history titles needing metadata heal
//
// History rows written during playback often lack a poster (provider gave none)
// and external IDs (provider-opaque title id, e.g. AllManga). That leaves posters
// blank and — with no external id — keeps reconciliation from ever learning the
// title's episode total, so finished series get mis-bucketed as "continue". This
// picks the titles worth re-resolving, most-recent first, capped to throttle work.
// =============================================================================

import { looksLikeOpaqueProviderNativeId } from "@kunai/core";
import type { HistoryProgress } from "@kunai/storage";
import type { MediaKind, ProviderExternalIds, ProviderId } from "@kunai/types";

export type HistoryHealTarget = {
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: MediaKind;
  readonly externalIds?: ProviderExternalIds;
  readonly anchorSeason?: number;
  readonly anchorEpisode?: number;
  readonly needsPoster: boolean;
  readonly needsExternalIds: boolean;
  readonly needsProviderNativeMapping: boolean;
  readonly providerId?: ProviderId;
};

const DEFAULT_HEAL_LIMIT = 8;
const PROVIDER_NATIVE_HISTORY_PROVIDERS = new Set<ProviderId>(["allanime", "miruro"]);

function needsProviderNativeMapping(anchor: HistoryProgress): boolean {
  const providerId = anchor.providerId;
  if (!providerId || !PROVIDER_NATIVE_HISTORY_PROVIDERS.has(providerId)) return false;
  if (!anchor.externalIds?.anilistId) return false;
  if (anchor.externalIds.providerNativeIds?.[providerId]) return false;
  return looksLikeOpaqueProviderNativeId(anchor.titleId, anchor.externalIds);
}

function hasExternalIds(externalIds: ProviderExternalIds | undefined): boolean {
  return Boolean(externalIds && Object.values(externalIds).some(Boolean));
}

/** One target per title (its most-recent row), for titles missing poster or ids. */
export function selectHistoryHealTargets(
  entries: readonly HistoryProgress[],
  options: { readonly limit?: number } = {},
): readonly HistoryHealTarget[] {
  const latestByTitle = new Map<string, HistoryProgress>();
  for (const entry of entries) {
    const current = latestByTitle.get(entry.titleId);
    if (!current || Date.parse(entry.updatedAt) > Date.parse(current.updatedAt)) {
      latestByTitle.set(entry.titleId, entry);
    }
  }

  const targets: HistoryHealTarget[] = [];
  for (const anchor of latestByTitle.values()) {
    const needsPoster = !anchor.posterUrl;
    const needsExternalIds = !hasExternalIds(anchor.externalIds);
    const needsProviderNative = needsProviderNativeMapping(anchor);
    if (!needsPoster && !needsExternalIds && !needsProviderNative) continue;
    targets.push({
      titleId: anchor.titleId,
      title: anchor.title,
      mediaKind: anchor.mediaKind,
      externalIds: anchor.externalIds,
      anchorSeason: anchor.season,
      anchorEpisode: anchor.episode,
      needsPoster,
      needsExternalIds,
      needsProviderNativeMapping: needsProviderNative,
      providerId: anchor.providerId,
    });
  }

  targets.sort(
    (left, right) => latestUpdatedAt(right, latestByTitle) - latestUpdatedAt(left, latestByTitle),
  );
  return targets.slice(0, Math.max(0, options.limit ?? DEFAULT_HEAL_LIMIT));
}

function latestUpdatedAt(
  target: HistoryHealTarget,
  latestByTitle: ReadonlyMap<string, HistoryProgress>,
): number {
  const row = latestByTitle.get(target.titleId);
  return row ? Date.parse(row.updatedAt) || 0 : 0;
}
