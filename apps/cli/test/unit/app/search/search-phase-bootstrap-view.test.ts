import { expect, test } from "bun:test";

import type { openBrowseShell } from "@/app-shell/browse-shell";
import { SearchPhase } from "@/app/search/SearchPhase";
import type { Container } from "@/container";
import { SessionStateManagerImpl } from "@/domain/session/SessionStateManager";
import type { SearchResult } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import { Connectivity } from "@/services/network/Connectivity";
import type { searchTitles } from "@/services/search/SearchRoutingService";

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => logger,
};

const hit: SearchResult = {
  id: "438631",
  type: "movie",
  title: "Dune",
  year: 2021,
} as unknown as SearchResult;

/**
 * `-S <query>` has to land on the results, not on the empty search surface.
 *
 * The view used to be chosen from the state snapshot taken at the top of the
 * phase loop, which is necessarily result-free: the bootstrap search only runs
 * when that snapshot has no results. So a successful `-S` search dispatched its
 * results and then immediately routed to `"search"`, and the run looked like the
 * query had merely been typed for you.
 */
test("a successful bootstrap search opens the results view, not the search surface", async () => {
  const stateManager = new SessionStateManagerImpl({ logger });
  let browseInput: Parameters<typeof openBrowseShell<SearchResult>>[0] | undefined;

  const phase = new SearchPhase({
    searchTitles: (async () => ({
      results: [hit],
      strategy: "direct",
      sourceId: "tmdb",
      evidence: undefined,
    })) as unknown as typeof searchTitles,
    openBrowseShell: async (input) => {
      browseInput = input;
      return { type: "cancelled" };
    },
  });

  const provider = {
    metadata: { id: "videasy", isAnimeProvider: false, isYoutubeProvider: false },
  };
  const container = {
    stateManager,
    connectivity: new Connectivity(() => true),
    logger,
    diagnosticsService: { record: () => {} },
    config: {
      offlineMode: false,
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      youtubeLanguageProfile: { audio: "original", subtitle: "none" },
      animeTitlePreference: "provider",
      getRaw: () => ({}),
    },
    searchRegistry: { getDefault: () => ({ metadata: { id: "tmdb" } }) },
    providerRegistry: { get: () => provider, getDefaultForMode: () => provider },
    queueService: { peekNext: () => null },
    releaseProgressCache: {
      summarizeActive: () => ({ episodeCount: 0, titleCount: 0 }),
      getByTitleIds: () => new Map(),
    },
    offlineAssetService: { listNextReadyByTitleCursors: () => [] },
  } as unknown as Container;

  await phase.execute(
    { initialQuery: "dune" },
    { container, signal: new AbortController().signal },
  );

  const state = stateManager.getState();
  expect(state.searchResults).toHaveLength(1);
  expect(state.searchState).toBe("ready");
  // The regression this test exists for.
  expect(state.view).toBe("results");
  expect(browseInput?.initialResults).toHaveLength(1);
});

test("a deferred idle load cannot publish a previous mode's continuation", async () => {
  const stateManager = new SessionStateManagerImpl({ logger });
  const provider = {
    metadata: { id: "vidlink", isAnimeProvider: false, isYoutubeProvider: false },
  };
  const phase = new SearchPhase({
    searchTitles: async () => {
      throw new Error("No network expected");
    },
    openBrowseShell: async (input) => {
      expect(input.loadIdleContext).toBeDefined();
      const loading = input.loadIdleContext!();
      stateManager.dispatch({ type: "SET_MODE", mode: "anime", provider: "hianime" });
      expect(await loading).toBeUndefined();
      return { type: "cancelled" };
    },
  });
  // SAFETY: this local-only fixture supplies the readers exercised before cancellation.
  const container = {
    stateManager,
    connectivity: new Connectivity(() => true),
    logger,
    diagnosticsService: { record: () => {} },
    config: {
      offlineMode: false,
      lastCalendarVisitAt: 0,
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      youtubeLanguageProfile: { audio: "original", subtitle: "none" },
      animeTitlePreference: "provider",
      getRaw: () => ({}),
    },
    searchRegistry: { getDefault: () => ({ metadata: { id: "tmdb" } }) },
    providerRegistry: { get: () => provider, getDefaultForMode: () => provider },
    queueService: { peekNext: () => null },
    releaseProgressCache: {
      summarizeActive: () => ({ episodeCount: 0, titleCount: 0 }),
      getByTitleIds: () => new Map(),
    },
    offlineAssetService: { listNextReadyByTitleCursors: () => [] },
    historyRepository: {
      listLatestByTitle: () => [
        {
          titleId: "tmdb:1",
          title: "Old movie",
          mediaKind: "movie",
          positionSeconds: 90,
          completed: false,
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
    listService: { getWatchlist: () => [] },
    followedTitleRepository: { listByPreference: () => [] },
  } as never;
  expect(
    await phase.execute(undefined, { container, signal: new AbortController().signal }),
  ).toEqual({ status: "cancelled" });
});
