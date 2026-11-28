import type { PhaseContext } from "@/app/session/Phase";
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
