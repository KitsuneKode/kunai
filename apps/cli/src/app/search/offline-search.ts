import type { BrowseShellSearchResponse } from "@/app-shell/types";
import {
  loadBrowseDisplayContext,
  mapBrowseResultOption,
} from "@/app/search/search-phase-browse-context";
import type { PhaseContext } from "@/app/session/Phase";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import { countLabel } from "@/domain/text-display";
import type { SearchResult } from "@/domain/types";
import type { OfflineAssetRecord } from "@kunai/storage";

function matchesQuery(title: string, query: string): boolean {
  const haystack = title.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function resultType(asset: OfflineAssetRecord): SearchResult["type"] {
  return asset.mediaKind === "series" || asset.mediaKind === "anime" ? "series" : "movie";
}

/** Offline search is local-first by construction: ready downloads are the
 * playable corpus, history is additional local memory. No catalog promise is
 * made here; the caller's subtitle says that lane needs connectivity. */
export function searchOfflineLibrary(
  container: PhaseContext["container"],
  query: string,
): readonly SearchResult[] {
  const byTitle = new Map<string, SearchResult & { readonly updatedAt: string }>();
  const assets = container.offlineAssetService
    .listAllAssets()
    .filter((asset) => asset.state === "ready" && matchesQuery(asset.titleName, query));

  for (const asset of assets) {
    const existing = byTitle.get(asset.titleId);
    if (existing) {
      byTitle.set(asset.titleId, {
        ...existing,
        episodeCount: (existing.episodeCount ?? 0) + 1,
        updatedAt: asset.updatedAt > existing.updatedAt ? asset.updatedAt : existing.updatedAt,
      });
      continue;
    }
    byTitle.set(asset.titleId, {
      id: asset.titleId,
      type: resultType(asset),
      title: asset.titleName,
      year: "",
      overview: "⬇ offline · local copy",
      posterPath: null,
      episodeCount: 1,
      isAnime: asset.mediaKind === "anime",
      durationSeconds: asset.durationMs ? Math.round(asset.durationMs / 1000) : undefined,
      updatedAt: asset.updatedAt,
    });
  }

  for (const entry of container.historyRepository.listLatestByTitle(500)) {
    if (byTitle.has(entry.titleId) || !matchesQuery(entry.title, query)) continue;
    byTitle.set(entry.titleId, {
      id: entry.titleId,
      type: entry.mediaKind === "series" || entry.mediaKind === "anime" ? "series" : "movie",
      title: entry.title,
      year: "",
      overview: "history · streaming needs a connection",
      posterPath: null,
      externalIds: entry.externalIds,
      isAnime: entry.mediaKind === "anime",
      updatedAt: entry.updatedAt,
    });
  }

  return [...byTitle.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ updatedAt: _updatedAt, ...result }) => result);
}

/** Complete interactive offline search response: records the query, commits the
 * local result set, and marks playable downloads explicitly. Kept out of
 * SearchPhase so the phase remains an orchestrator rather than another view-model. */
export async function resolveOfflineSearchResponse({
  container,
  query,
  stateManager,
}: {
  readonly container: PhaseContext["container"];
  readonly query: string;
  readonly stateManager: SessionStateManager;
}): Promise<BrowseShellSearchResponse<SearchResult>> {
  const results = [...searchOfflineLibrary(container, query)];
  stateManager.dispatch({ type: "SET_SEARCH_RESULTS", results });
  stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "ready" });
  const display = await loadBrowseDisplayContext(container, results);
  const offlineReadyIds = new Set(
    container.offlineAssetService
      .listAllAssets()
      .filter((asset) => asset.state === "ready")
      .map((asset) => asset.titleId),
  );
  return {
    options: results.map((result) => {
      const option = mapBrowseResultOption(container, display, result);
      return offlineReadyIds.has(result.id)
        ? { ...option, detail: `⬇ offline · ${option.detail}` }
        : option;
    }),
    subtitle: `${countLabel(results.length, "local result")} · catalog search needs a connection`,
    emptyMessage:
      "No local matches. Catalog search needs a connection; downloaded titles and history are searchable offline.",
  };
}
