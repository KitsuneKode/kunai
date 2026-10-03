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

/**
 * A bounce notice must reach the browse shell's warnings strip.
 *
 * `SET_PLAYBACK_FEEDBACK` notes are wiped twice before the next surface can
 * read them — once by PlaybackPhase's own `finally` and again by
 * RESET_CONTENT in the bounce. SessionController therefore carries the reason
 * on the structured outcome (`{ type: "back_to_results", notice }`) and hands
 * it in as `browseNotice`; if the merge is dropped, an episode-catalog failure
 * silently lands the user back on results — the exact regression this pins.
 */
test("a browseNotice arrives as a browse-shell warning row", async () => {
  const stateManager = new SessionStateManagerImpl({ logger });
  let browseInput: Parameters<typeof openBrowseShell<SearchResult>>[0] | undefined;

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

  const phase = new SearchPhase({
    searchTitles: (async () => ({
      results: [],
      strategy: "direct",
      sourceId: "tmdb",
      evidence: undefined,
    })) as unknown as typeof searchTitles,
    openBrowseShell: async (input) => {
      browseInput = input;
      return { type: "cancelled" };
    },
  });

  await phase.execute(
    { browseNotice: "Could not load season data for this title. Check your connection." },
    { container, signal: new AbortController().signal },
  );

  expect(browseInput?.initialWarnings).toContain(
    "Could not load season data for this title. Check your connection.",
  );
});

/**
 * Notes dispatched between browse mounts must reach the next mount.
 *
 * Phases that run while browse is unmounted — DownloadOnlyPhase's
 * eligibility gate ("Download unavailable: …") and the filter-chip loop's
 * "Filter added: …" — signal via SET_PLAYBACK_FEEDBACK, which only the
 * playback surface reads. SearchPhase lifts a note that changed since the
 * last mount onto the warnings strip and clears it; if the lift is dropped,
 * `d` with downloads disabled bounces the user back to results with no
 * visible reason — the regression this pins.
 */
test("an inter-mount playback feedback note arrives as a browse warning", async () => {
  const stateManager = new SessionStateManagerImpl({ logger });
  const browseInputs: Parameters<typeof openBrowseShell<SearchResult>>[0][] = [];

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

  const phase = new SearchPhase({
    searchTitles: (async () => ({
      results: [],
      strategy: "direct",
      sourceId: "tmdb",
      evidence: undefined,
    })) as unknown as typeof searchTitles,
    openBrowseShell: async (input) => {
      browseInputs.push(input);
      if (browseInputs.length === 1) {
        // What an inter-mount phase leaves behind — e.g. DownloadOnlyPhase's
        // eligibility gate setting "Download unavailable: …" before its
        // `continue` lands back on this remount.
        stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: "Download unavailable: Downloads are disabled.",
        });
        return { type: "action", action: "noop-action-for-test" };
      }
      return { type: "cancelled" };
    },
  });

  await phase.execute(
    { initialQuery: "dune" },
    { container, signal: new AbortController().signal },
  );

  expect(browseInputs).toHaveLength(2);
  // Mount 1 predates the note — baseline protection keeps it off this mount.
  expect(browseInputs[0]?.initialWarnings ?? []).not.toContain(
    "Download unavailable: Downloads are disabled.",
  );
  expect(browseInputs[1]?.initialWarnings).toContain(
    "Download unavailable: Downloads are disabled.",
  );
  // Consumed on lift: the note does not linger for a later playback surface.
  expect(stateManager.getState().playbackNote).toBeNull();
});
