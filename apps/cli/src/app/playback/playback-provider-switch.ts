import { resolveTitleHistoryLookupId } from "@/app/bootstrap/title-info";
import type { Container } from "@/container";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { invalidateEpisodePlaybackCaches } from "./playback-source-cache-invalidation";

export function resolveTitleProviderPreference(
  config: Pick<KitsuneConfig, "titleProviderPreferences">,
  titleId: string,
  alternateTitleId?: string,
): string | undefined {
  const prefs = config.titleProviderPreferences;
  return prefs[titleId] ?? (alternateTitleId ? prefs[alternateTitleId] : undefined);
}

export function resolveTitleProviderPreferenceForTitle(
  config: Pick<KitsuneConfig, "titleProviderPreferences">,
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  mode?: ShellMode,
): string | undefined {
  const canonicalId = resolveTitleHistoryLookupId(title, mode);
  return resolveTitleProviderPreference(config, canonicalId, title.id);
}

async function persistTitleProviderPreference(
  container: Pick<Container, "config">,
  title: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  providerId: string,
  mode?: ShellMode,
): Promise<void> {
  const raw = container.config.getRaw();
  const canonicalId = resolveTitleHistoryLookupId(title, mode);
  const nextPrefs = { ...raw.titleProviderPreferences };

  if (canonicalId !== title.id) {
    delete nextPrefs[title.id];
  }

  if (nextPrefs[canonicalId] === providerId) return;

  nextPrefs[canonicalId] = providerId;
  await container.config.update({ titleProviderPreferences: nextPrefs });
  await container.config.save();
}

/**
 * Apply a saved per-title provider before playback/history resume.
 * Returns true when a preference was applied.
 *
 * Preference affects default provider selection and cache invalidation on
 * explicit switch; it does not disable automatic fallback when that provider
 * cannot resolve the episode (see honorExplicitProviderOnly in PlaybackPhase).
 */
export function applyTitleProviderPreferenceToSession(
  container: Pick<Container, "config" | "stateManager" | "providerRegistry">,
  titleId: string,
  title?: Pick<TitleInfo, "id" | "type" | "externalIds" | "isAnime">,
  mode?: ShellMode,
): boolean {
  const preferred = title
    ? resolveTitleProviderPreferenceForTitle(container.config.getRaw(), title, mode)
    : resolveTitleProviderPreference(container.config.getRaw(), titleId);
  if (!preferred) return false;

  const state = container.stateManager.getState();
  if (state.provider === preferred) return false;

  const provider = container.providerRegistry.get(preferred);
  if (provider) {
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode: provider.metadata.isAnimeProvider ? "anime" : "series",
      provider: preferred,
    });
  } else {
    container.stateManager.dispatch({ type: "SET_PROVIDER", provider: preferred });
  }
  return true;
}

/** User explicitly chose a provider — invalidate stale cross-provider caches and force a fresh resolve. */
export async function applyUserProviderSwitch(input: {
  readonly container: Container;
  readonly fromProviderId: string;
  readonly toProviderId: string;
  readonly title?: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly mode?: ShellMode;
}): Promise<void> {
  const { container, fromProviderId, toProviderId, title, episode } = input;
  if (fromProviderId === toProviderId) return;

  const {
    stateManager,
    config,
    cacheStore,
    sourceInventory,
    diagnosticsService,
    providerRegistry,
  } = container;
  const state = stateManager.getState();
  const mode = input.mode ?? state.mode;
  const configRaw = config.getRaw();
  let invalidatedProviders = 0;

  stateManager.dispatch({
    type: "SET_PROVIDER",
    provider: toProviderId,
    forceFreshResolve: true,
  });

  if (title) {
    await persistTitleProviderPreference(container, title, toProviderId, mode);
    const canonicalId = resolveTitleHistoryLookupId(title, mode);
    container.titleProviderHealth.clear(canonicalId);
    if (canonicalId !== title.id) {
      container.titleProviderHealth.clear(title.id);
    }
  }

  if (title && episode) {
    const compatibleProviderIds = new Set(
      providerRegistry.getCompatible(title, mode).map((provider) => provider.metadata.id),
    );
    const providerIds = [fromProviderId, toProviderId].filter((providerId, index, ids) => {
      return ids.indexOf(providerId) === index && compatibleProviderIds.has(providerId);
    });
    invalidatedProviders = providerIds.length;
    await Promise.all(
      providerIds.map((providerId) =>
        invalidateEpisodePlaybackCaches({
          cacheStore,
          sourceInventory,
          providerId,
          title,
          episode,
          mode,
          config: configRaw,
        }),
      ),
    );
  }

  diagnosticsService.record({
    category: "ui",
    message: "User switched provider with playback cache invalidation",
    context: {
      mode,
      from: fromProviderId,
      to: toProviderId,
      titleId: title?.id ?? null,
      season: episode?.season ?? null,
      episode: episode?.episode ?? null,
      persistedPreference: Boolean(title),
      invalidatedProviders,
    },
  });
}

export type ProviderPickerSelectionResult = {
  readonly changed: boolean;
  readonly recomputeRequested: boolean;
};

export async function applyProviderPickerSelection(input: {
  readonly container: Container;
  readonly pickedProviderId: string | null | undefined;
  readonly reason: string;
}): Promise<ProviderPickerSelectionResult> {
  const { container, pickedProviderId, reason } = input;
  if (!pickedProviderId) return { changed: false, recomputeRequested: false };

  const state = container.stateManager.getState();
  const fromProviderId = resolveStreamProviderId(state.stream) ?? state.provider;
  if (pickedProviderId === fromProviderId) {
    return { changed: false, recomputeRequested: false };
  }

  await applyUserProviderSwitch({
    container,
    fromProviderId,
    toProviderId: pickedProviderId,
    ...(state.currentTitle && state.currentEpisode
      ? { title: state.currentTitle, episode: state.currentEpisode, mode: state.mode }
      : {}),
  });

  const next = container.stateManager.getState();
  const recomputeRequested =
    isPlaybackActiveForProviderSwitch(next.playbackStatus) && Boolean(next.currentEpisode);
  if (recomputeRequested) {
    void container.playerControl.recomputeCurrentPlayback(reason);
  }

  return { changed: true, recomputeRequested };
}

export function resolveStreamProviderId(
  stream: { readonly providerResolveResult?: { readonly providerId?: string } } | null,
): string | undefined {
  return stream?.providerResolveResult?.providerId;
}

function isPlaybackActiveForProviderSwitch(status: string): boolean {
  return (
    status === "loading" ||
    status === "ready" ||
    status === "buffering" ||
    status === "seeking" ||
    status === "stalled" ||
    status === "playing"
  );
}
