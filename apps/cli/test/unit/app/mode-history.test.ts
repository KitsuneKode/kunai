import { afterEach, expect, test } from "bun:test";

import { buildBrowseIdleContext } from "@/app-shell/browse-idle-context";
import { loadLocalSuggestionCorpus } from "@/app/search/search-suggestions";
import { HistoryRepository } from "@kunai/storage";
import { createTempStoreRegistry } from "@kunai/storage/testing";

const stores = createTempStoreRegistry();
afterEach(() => stores.cleanup());

function sources(historyRepository: HistoryRepository) {
  return {
    historyRepository,
    queueService: { peekNext: () => null },
    releaseProgressCache: {
      summarizeActive: () => ({ titleCount: 0, episodeCount: 0 }),
      getByTitleIds: () => new Map(),
    },
    offlineAssetService: { listNextReadyByTitleCursors: () => [] },
    config: { lastCalendarVisitAt: 0 },
    followedTitleRepository: { listByPreference: () => [] },
    listService: { getFavorites: () => [], getWatchlist: () => [], getListItems: () => [] },
    listRepository: { getLists: () => [] },
    playlistsRepository: { list: () => [], listItems: () => [] },
  };
}

test("500 newer foreign titles cannot hide a mode's resume or suggestion", async () => {
  const historyRepository = new HistoryRepository(stores.store("scoped-history", "data"));
  historyRepository.upsertProgress({
    title: { id: "anime-old", title: "Older anime", kind: "anime" },
    providerId: "hianime",
    positionSeconds: 90,
    updatedAt: "2026-01-01T00:00:00Z",
  });
  for (let index = 0; index < 501; index++) {
    historyRepository.upsertProgress({
      title: { id: `video-${index}`, title: `Video ${index}`, kind: "video" },
      providerId: "youtube",
      positionSeconds: 90,
      updatedAt: new Date(Date.UTC(2026, 5, 1, 0, 0, index)).toISOString(),
    });
  }
  expect(historyRepository.listLatestByTitle()).toHaveLength(500);
  const source = sources(historyRepository);
  // SAFETY: read-only fixture supplies every idle-context reader.
  const idle = await buildBrowseIdleContext(source as never, { mode: "anime" });
  expect(idle.idleContext?.continueWatching?.title).toBe("Older anime");
  expect(loadLocalSuggestionCorpus(source, "anime").map((row) => row.title)).toEqual([
    "Older anime",
  ]);
});

test("linked catalog ids do not change a saved title's primary lane", async () => {
  const source = sources(new HistoryRepository(stores.store("linked-lane", "data")));
  const linked = {
    titleId: "tmdb:123",
    title: "Linked series",
    mediaKind: "series",
    externalIds: { anilistId: "123" },
    addedAt: "2026-01-01T00:00:00Z",
  };
  const input = {
    ...source,
    queueService: { peekNext: () => linked },
    listService: { ...source.listService, getWatchlist: () => [linked] },
  };
  // SAFETY: the shared read-only fixture supplies every reader both projections consume.
  const scopedSource = input as never;
  const series = await buildBrowseIdleContext(scopedSource, { mode: "series" });
  expect(series.idleContext?.savedNext?.title).toBe(linked.title);
  expect(series.idleContext?.playlistNext?.title).toBe(linked.title);
  expect(loadLocalSuggestionCorpus(scopedSource, "series")[0]?.title).toBe(linked.title);
  const anime = await buildBrowseIdleContext(scopedSource, { mode: "anime" });
  expect(anime.idleContext?.savedNext).toBeUndefined();
  expect(anime.idleContext?.playlistNext).toBeUndefined();
});
