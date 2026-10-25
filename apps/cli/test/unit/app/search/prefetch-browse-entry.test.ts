// =============================================================================
// prefetch-browse-entry.test.ts — the dwell prefetch gating contract.
//
// The seam exists to make Enter cheap; it must never pay work Enter wouldn't,
// never touch the network offline, and never surface a failure. Loaders are
// injected (codebase convention over mock.module) so no real fetch can run.
// =============================================================================

import { describe, expect, test } from "bun:test";

import {
  prefetchBrowseEntrySelection,
  type BrowseEntryPrefetchContainer,
  type BrowseEntryPrefetchLoaders,
} from "@/app/search/prefetch-browse-entry";
import type { SearchResult, TitleInfo } from "@/domain/types";
import type { ProviderEpisodeOption } from "@kunai/types";

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "tmdb:42",
    type: "series",
    title: "Example Show",
    year: "2024",
    overview: "",
    posterPath: null,
    ...overrides,
  };
}

function makeContainer(args: {
  readonly online?: boolean;
  readonly historySeason?: number;
  readonly onListEpisodes?: (title: TitleInfo) => Promise<readonly ProviderEpisodeOption[] | null>;
}): BrowseEntryPrefetchContainer {
  const listCalls: TitleInfo[] = [];
  const onListEpisodes = args.onListEpisodes;
  const provider = {
    metadata: { id: "allanime" },
    listEpisodes: onListEpisodes
      ? async ({ title }: { title: TitleInfo }) => {
          listCalls.push(title);
          return onListEpisodes(title);
        }
      : undefined,
  };
  // SAFETY: deliberately partial stub — prefetch reads only the members
  // defined here; the rest of the container is unused in these tests.
  return {
    connectivity: { isOnline: () => args.online !== false },
    config: {
      animeLanguageProfile: { audio: "ja", subtitle: "en" },
      animeTitlePreference: "provider",
    },
    catalogIdentityService: { enrich: async () => ({}) },
    providerRegistry: {
      getDefault: () => provider,
      get: () => provider,
    },
    historyRepository: {
      getLatestForTitleIdentity: () =>
        args.historySeason !== undefined ? { season: args.historySeason } : undefined,
    },
  } as never;
}

function noopLoaders() {
  type PrefetchCalls = {
    mapAnime: number;
    enrich: number;
    fetchDetail: { id: string; type: string }[];
    fetchSeries: { id: string; season?: number }[];
  };
  const calls: PrefetchCalls = {
    mapAnime: 0,
    enrich: 0,
    fetchDetail: [],
    fetchSeries: [],
  };
  return {
    calls,
    // SAFETY: call-counting stubs — each loader is cast to the real
    // signature via `never` so the stubs stay minimal; the prefetch path
    // only checks they ran.
    loaders: {
      mapAnime: (async (result: SearchResult) => {
        calls.mapAnime += 1;
        return result;
      }) as never,
      enrich: (async (
        _svc: Parameters<BrowseEntryPrefetchLoaders["enrich"]>[0],
        title: TitleInfo,
      ) => {
        calls.enrich += 1;
        return title;
      }) as never,
      fetchDetail: (async (id: string, type: "movie" | "series") => {
        calls.fetchDetail.push({ id, type });
        return {};
      }) as never,
      fetchSeries: (async (id: string, season?: number) => {
        calls.fetchSeries.push({ id, season });
        return { seasons: [1], episodes: [] };
      }) as never,
    },
  };
}

const signal = () => new AbortController().signal;

describe("prefetchBrowseEntrySelection", () => {
  test("offline is a hard no-op — prefetch exists to make Enter fast, not to pay anyway", async () => {
    const { calls, loaders } = noopLoaders();
    await prefetchBrowseEntrySelection({
      container: makeContainer({ online: false }),
      result: searchResult(),
      fallbackMode: "series",
      providerId: "vidking",
      signal: signal(),
      warmedAnimeEpisodeCaches: new Set(),
      loaders,
    });
    expect(calls.mapAnime).toBe(0);
    expect(calls.enrich).toBe(0);
    expect(calls.fetchDetail).toHaveLength(0);
  });

  test("youtube results have no catalog chain to warm", async () => {
    const { calls, loaders } = noopLoaders();
    await prefetchBrowseEntrySelection({
      container: makeContainer({}),
      result: searchResult({ id: "youtube:abc", resultKind: "video" }),
      fallbackMode: "youtube",
      providerId: "youtube",
      signal: signal(),
      warmedAnimeEpisodeCaches: new Set(),
      loaders,
    });
    expect(calls.enrich).toBe(0);
    expect(calls.fetchDetail).toHaveLength(0);
  });

  test("an already-aborted signal exits before any work", async () => {
    const { calls, loaders } = noopLoaders();
    const controller = new AbortController();
    controller.abort();
    await prefetchBrowseEntrySelection({
      container: makeContainer({}),
      result: searchResult(),
      fallbackMode: "series",
      providerId: "vidking",
      signal: controller.signal,
      warmedAnimeEpisodeCaches: new Set(),
      loaders,
    });
    expect(calls.enrich).toBe(0);
  });

  test("tmdb series warms detail + the watched season's episode rows", async () => {
    const { calls, loaders } = noopLoaders();
    await prefetchBrowseEntrySelection({
      container: makeContainer({ historySeason: 3 }),
      result: searchResult(),
      fallbackMode: "series",
      providerId: "vidking",
      signal: signal(),
      warmedAnimeEpisodeCaches: new Set(),
      loaders,
    });
    expect(calls.enrich).toBe(1);
    expect(calls.fetchDetail).toEqual([{ id: "tmdb:42", type: "series" }]);
    // The watched season, not blindly S1 — the finished→next resolution reads it.
    expect(calls.fetchSeries).toEqual([{ id: "tmdb:42", season: 3 }]);
    expect(calls.mapAnime).toBe(0);
  });

  test("movies warm detail only — no season/episode axis exists", async () => {
    const { calls, loaders } = noopLoaders();
    await prefetchBrowseEntrySelection({
      container: makeContainer({}),
      result: searchResult({ type: "movie" }),
      fallbackMode: "series",
      providerId: "vidking",
      signal: signal(),
      warmedAnimeEpisodeCaches: new Set(),
      loaders,
    });
    expect(calls.fetchDetail).toEqual([{ id: "tmdb:42", type: "movie" }]);
    expect(calls.fetchSeries).toHaveLength(0);
  });

  test("anime rows warm the provider-native episode catalog once per session", async () => {
    const listed: string[] = [];
    const { calls, loaders } = noopLoaders();
    const container = makeContainer({
      onListEpisodes: async (title) => {
        listed.push(title.id);
        return [];
      },
    });
    const warmed = new Set<string>();
    const args = {
      container,
      result: searchResult({ isAnime: true }),
      fallbackMode: "anime" as const,
      providerId: "allanime",
      signal: signal(),
      warmedAnimeEpisodeCaches: warmed,
      loaders,
    };
    await prefetchBrowseEntrySelection(args);
    await prefetchBrowseEntrySelection(args);

    expect(calls.mapAnime).toBe(2); // mapping mirrors Enter every dwell
    expect(listed).toEqual(["tmdb:42"]); // listEpisodes deduped via warmed set
    expect(calls.fetchDetail).toEqual([
      { id: "tmdb:42", type: "series" },
      { id: "tmdb:42", type: "series" },
    ]);
  });

  test("loader failures never surface — the warm is silent by contract", async () => {
    const { loaders } = noopLoaders();
    // SAFETY: the rejection stub is cast to the real loader signature — the
    // test only asserts the failure path runs.
    loaders.fetchDetail = (() => Promise.reject(new Error("tmdb down"))) as never;
    await expect(
      prefetchBrowseEntrySelection({
        container: makeContainer({}),
        result: searchResult(),
        fallbackMode: "series",
        providerId: "vidking",
        signal: signal(),
        warmedAnimeEpisodeCaches: new Set(),
        loaders,
      }),
    ).resolves.toBeUndefined();
  });
});
