import { describe, expect, test } from "bun:test";

import type { SearchResult } from "@/domain/types";
import type { Provider } from "@/services/providers/Provider";
import { warmTopAnimeEpisodeCache } from "@/services/providers/warm-episode-cache";

function result(over: Partial<SearchResult>): SearchResult {
  return {
    id: "anilist:21",
    type: "series",
    title: "One Piece",
    isAnime: true,
    ...over,
  } as SearchResult;
}

function stubProvider(calls: string[]): Provider {
  return {
    listEpisodes: async (req: { title: { id: string } }) => {
      calls.push(req.title.id);
      return [];
    },
  } as unknown as Provider;
}

function warm(over: Partial<Parameters<typeof warmTopAnimeEpisodeCache>[0]>) {
  warmTopAnimeEpisodeCache({
    results: [result({})],
    provider: undefined,
    audioPreference: "original",
    subtitlePreference: "en",
    warmed: new Set(),
    ...over,
  });
}

describe("warmTopAnimeEpisodeCache", () => {
  test("warms the top anime result via listEpisodes", async () => {
    const calls: string[] = [];
    warm({ provider: stubProvider(calls) });
    await Promise.resolve();
    expect(calls).toEqual(["anilist:21"]);
  });

  test("only the single top anime result is warmed, not the whole list", async () => {
    const calls: string[] = [];
    warm({
      provider: stubProvider(calls),
      results: [result({ id: "anilist:21" }), result({ id: "anilist:20" })],
    });
    await Promise.resolve();
    expect(calls).toEqual(["anilist:21"]);
  });

  test("dedupes across calls with a shared warmed set", async () => {
    const calls: string[] = [];
    const warmed = new Set<string>();
    warm({ provider: stubProvider(calls), warmed });
    warm({ provider: stubProvider(calls), warmed });
    await Promise.resolve();
    expect(calls).toEqual(["anilist:21"]);
  });

  test("skips non-anime results", async () => {
    const calls: string[] = [];
    warm({ provider: stubProvider(calls), results: [result({ isAnime: false })] });
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  test("no-op when the provider cannot list episodes", () => {
    expect(() => warm({ provider: {} as Provider })).not.toThrow();
  });

  test("a rejecting listEpisodes never surfaces (fire-and-forget)", async () => {
    const provider = {
      listEpisodes: async () => {
        throw new Error("network down");
      },
    } as unknown as Provider;
    expect(() => warm({ provider })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
