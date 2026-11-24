import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { openBrowseShell } from "@/app-shell/browse-shell";
import { SearchPhase } from "@/app/search/SearchPhase";
import type { Container } from "@/container";
import { SessionStateManagerImpl } from "@/domain/session/SessionStateManager";
import type { SearchResult } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import { kunaiConfigDir } from "@/infra/storage/kunai-paths";
import { Connectivity } from "@/services/network/Connectivity";
import { flushSearchHistory } from "@/services/persistence/search-history";
import type { searchTitles } from "@/services/search/SearchRoutingService";

import { applyStorageRootEnv } from "../../../helpers/storage-env";

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
  // The bootstrap search records "dune" in search history. That must land in a
  // throwaway profile, not the developer's real config dir.
  const sandbox = mkdtempSync(join(tmpdir(), "kunai-search-phase-bootstrap-"));
  const restoreEnv = applyStorageRootEnv(sandbox);
  try {
    await runBootstrapSearch();
    // Wait for the writer while the sandbox is still applied, or the save
    // resolves its path after the restore and lands in the real profile.
    await flushSearchHistory();
    const historyFile = join(kunaiConfigDir(), "search-history-series.json");
    expect(historyFile.startsWith(sandbox)).toBe(true);
    expect(JSON.parse(readFileSync(historyFile, "utf8"))).toEqual(["dune"]);
  } finally {
    restoreEnv();
    rmSync(sandbox, { recursive: true, force: true });
  }
});

async function runBootstrapSearch(): Promise<void> {
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
}
