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

test("bootstrap network failure opens browse once with retained query and recovery", async () => {
  const stateManager = new SessionStateManagerImpl({ logger });
  const connectivity = new Connectivity(() => false);
  const diagnostics: unknown[] = [];
  let searchCalls = 0;
  let browseInput: Parameters<typeof openBrowseShell<SearchResult>>[0] | undefined;

  const phase = new SearchPhase({
    searchTitles: (async () => {
      searchCalls += 1;
      throw new Error("Unable to connect. Is the computer able to access the url?");
    }) as typeof searchTitles,
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
    connectivity,
    logger,
    diagnosticsService: { record: (event: unknown) => diagnostics.push(event) },
    config: {
      offlineMode: false,
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      youtubeLanguageProfile: { audio: "original", subtitle: "none" },
      animeTitlePreference: "provider",
      getRaw: () => ({}),
    },
    searchRegistry: { getDefault: () => ({ metadata: { id: "tmdb" } }) },
    providerRegistry: {
      get: () => provider,
      getDefaultForMode: () => provider,
    },
    queueService: { peekNext: () => null },
    releaseProgressCache: {
      summarizeActive: () => ({ episodeCount: 0, titleCount: 0 }),
      getByTitleIds: () => new Map(),
    },
    offlineAssetService: { listNextReadyByTitleCursors: () => [] },
  } as unknown as Container;

  const result = await phase.execute(
    { initialQuery: "Bojack Horseman" },
    { container, signal: new AbortController().signal },
  );

  expect(result).toEqual({ status: "cancelled" });
  expect(searchCalls).toBe(1);
  expect(stateManager.getState()).toMatchObject({
    searchQuery: "Bojack Horseman",
    searchState: "error",
  });
  expect(browseInput?.initialQuery).toBe("Bojack Horseman");
  expect(browseInput?.initialErrorMessage).toBe(
    "Search failed: Unable to connect. Is the computer able to access the url? · retry or open /offline",
  );
  const failures = diagnostics.filter(
    (event) =>
      typeof event === "object" &&
      event !== null &&
      "operation" in event &&
      event.operation === "search.bootstrap.failed",
  );
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({
    category: "search",
    context: {
      error: "Error: Unable to connect. Is the computer able to access the url?",
      failureClass: "offline",
      recommendedAction: "retry",
    },
  });
});

test("offline onSuggest returns no catalog rows and never calls the registry, while the local corpus still loads", async () => {
  const stateManager = new SessionStateManagerImpl({ logger });
  const connectivity = new Connectivity(() => false);
  let registrySearches = 0;
  let browseInput: Parameters<typeof openBrowseShell<SearchResult>>[0] | undefined;

  const phase = new SearchPhase({
    searchTitles: (async () => {
      throw new Error("Unable to connect. Is the computer able to access the url?");
    }) as typeof searchTitles,
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
    connectivity,
    logger,
    diagnosticsService: { record: () => {} },
    config: {
      offlineMode: false,
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      youtubeLanguageProfile: { audio: "original", subtitle: "none" },
      animeTitlePreference: "provider",
      getRaw: () => ({}),
    },
    searchRegistry: {
      getDefault: () => ({
        metadata: { id: "tmdb" },
        search: async () => {
          registrySearches += 1;
          return [];
        },
      }),
    },
    providerRegistry: {
      get: () => provider,
      getDefaultForMode: () => provider,
    },
    queueService: { peekNext: () => null },
    releaseProgressCache: {
      summarizeActive: () => ({ episodeCount: 0, titleCount: 0 }),
      getByTitleIds: () => new Map(),
    },
    offlineAssetService: { listNextReadyByTitleCursors: () => [] },
    historyRepository: {
      listLatestByTitle: () => [
        {
          key: "tmdb:local-1",
          titleId: "tmdb:local-1",
          mediaKind: "movie",
          title: "Local Favorite",
          positionSeconds: 0,
        },
      ],
    },
  } as unknown as Container;

  await phase.execute(
    { initialQuery: "local" },
    { container, signal: new AbortController().signal },
  );

  const catalog = await browseInput?.onSuggest?.("loc", new AbortController().signal);
  expect(catalog).toEqual([]);
  expect(registrySearches).toBe(0);

  const localRows = browseInput?.loadLocalSuggestions?.() ?? [];
  expect(localRows.some((row) => row.id === "watched:tmdb:local-1")).toBe(true);
});
