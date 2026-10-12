// =============================================================================
// prefetch-browse-entry.ts — warm what Enter on the rested row would pay.
//
// browse-shell fires this after a result has been highlighted ~500ms. The work
// mirrors the select→PlaybackPhase entry chain exactly, so pressing Enter on a
// rested row hits warm caches instead of cold network:
//
//   result ──(anime)──> mapAnimeDiscoveryResultToProviderNative
//         ──> titleInfoFromSearchResult ──> enrichSelectedTitleIdentity
//         ──> fetchTitleDetail (detail cache: poster rail, detail sheet)
//         ──> anime: provider.listEpisodes (Cloudflare-gated catalog, seconds)
//             tmdb : fetchSeriesData      (season + episode caches, incl. the
//                                        watched season for history resumes)
//
// Contract: silent (every failure is swallowed), abortable, no session-state
// writes, and never runs while offline — it exists only to make Enter fast.
// =============================================================================

import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/discover/anime-provider-mapping";
import { chooseSearchResultTitle } from "@/app/search/browse-option-mappers";
import { enrichSelectedTitleIdentity } from "@/app/search/enrich-selected-title";
import { resolveShellModeForSearchResult } from "@/app/search/search-selection-routing";
import type { Container } from "@/container";
import { usesProviderNativeEpisodeCatalog } from "@/domain/media/provider-native-episodes";
import type { SearchResult, ShellMode } from "@/domain/types";
import { fetchTitleDetail } from "@/services/catalog/TitleDetailService";
import { fetchSeriesData } from "@/tmdb";

export type BrowseEntryPrefetchContainer = Pick<
  Container,
  "connectivity" | "config" | "catalogIdentityService" | "providerRegistry" | "historyRepository"
>;

/**
 * Injectable seam for tests — the codebase convention over `mock.module`,
 * whose process-wide stubs leak between suites. Defaults are the real loaders.
 */
export type BrowseEntryPrefetchLoaders = {
  readonly mapAnime: typeof mapAnimeDiscoveryResultToProviderNative;
  readonly enrich: typeof enrichSelectedTitleIdentity;
  readonly fetchDetail: typeof fetchTitleDetail;
  readonly fetchSeries: typeof fetchSeriesData;
};

const DEFAULT_LOADERS: BrowseEntryPrefetchLoaders = {
  mapAnime: mapAnimeDiscoveryResultToProviderNative,
  enrich: enrichSelectedTitleIdentity,
  fetchDetail: fetchTitleDetail,
  fetchSeries: fetchSeriesData,
};

/**
 * Prefetch the select-path work for one rested result. Callers dedupe per
 * result id before calling; the returned promise resolves when the warm is
 * done and never rejects — fire and forget.
 */
export async function prefetchBrowseEntrySelection(args: {
  readonly container: BrowseEntryPrefetchContainer;
  readonly result: SearchResult;
  /** Session mode at fire time — the same fallback Enter's routing uses. */
  readonly fallbackMode: ShellMode;
  /** Session provider — the same id Enter's anime mapping routes through. */
  readonly providerId: string;
  readonly signal: AbortSignal;
  /** Shared session dedupe for the provider-native episode catalog fetch. */
  readonly warmedAnimeEpisodeCaches: Set<string>;
  readonly loaders?: Partial<BrowseEntryPrefetchLoaders>;
}): Promise<void> {
  const { container, result, signal } = args;
  if (signal.aborted || !container.connectivity.isOnline()) return;

  const selectionMode = resolveShellModeForSearchResult(result, args.fallbackMode);
  // YouTube entries resolve straight into provider playback — there is no
  // catalog/episode chain to warm.
  if (selectionMode === "youtube") return;

  const loaders: BrowseEntryPrefetchLoaders = { ...DEFAULT_LOADERS, ...args.loaders };

  try {
    const selected =
      selectionMode === "anime"
        ? await loaders.mapAnime(result, {
            mode: selectionMode,
            providerId: args.providerId,
            animeLanguageProfile: container.config.animeLanguageProfile,
            providerRegistry: container.providerRegistry,
            signal,
          })
        : result;
    if (signal.aborted) return;

    const title = await loaders.enrich(
      container.catalogIdentityService,
      titleInfoFromSearchResult(
        selected,
        chooseSearchResultTitle(selected, container.config.animeTitlePreference),
      ),
      selectionMode,
      signal,
    );
    if (signal.aborted) return;

    const isAnime = selectionMode === "anime" || title.isAnime === true;
    const tasks: Promise<unknown>[] = [
      loaders.fetchDetail(title.id, title.type, signal, {
        externalIds: title.externalIds,
        isAnime,
      }),
    ];

    if (title.type === "series") {
      if (usesProviderNativeEpisodeCatalog(selectionMode, title.id)) {
        // Same provider + language context PlaybackPhase's episode catalog
        // reads, so the warmed entry is the one Enter reuses. The shared
        // dedupe set records raw result ids (the top-result warm) and enriched
        // title ids (this path) — check both before re-paying the gated fetch.
        const provider = container.providerRegistry.getDefault(true);
        const alreadyWarmed =
          args.warmedAnimeEpisodeCaches.has(title.id) ||
          args.warmedAnimeEpisodeCaches.has(result.id);
        if (provider?.listEpisodes && !alreadyWarmed) {
          args.warmedAnimeEpisodeCaches.add(title.id);
          args.warmedAnimeEpisodeCaches.add(result.id);
          tasks.push(
            provider.listEpisodes(
              {
                title,
                audioPreference: container.config.animeLanguageProfile.audio,
                subtitlePreference: container.config.animeLanguageProfile.subtitle,
              },
              signal,
            ),
          );
        }
      } else {
        // fetchSeriesData warms both the season list (the seasonCount gate
        // Enter always pays) and the watched season's episode rows (what a
        // finished history's next-episode resolution reads).
        const historySeason = container.historyRepository.getLatestForTitleIdentity({
          id: title.id,
          kind: isAnime ? "anime" : "series",
          externalIds: title.externalIds,
        })?.season;
        tasks.push(loaders.fetchSeries(title.id, historySeason));
      }
    }

    await Promise.allSettled(tasks);
  } catch {
    // A prefetch exists to make Enter fast — every failure is silent and the
    // real path retries what it still needs.
  }
}
