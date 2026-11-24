import { afterEach, describe, expect, test } from "bun:test";

import {
  CATALOG_FALLBACK_BREAKER_MS,
  resetCatalogSourceBreakersForTest,
  walkCatalogSources,
  type CatalogSource,
} from "@/services/catalog/catalog-source";
import { catalogAnswersSnapshot } from "@/services/catalog/catalog-source-ledger";

afterEach(() => resetCatalogSourceBreakersForTest());

function source(
  id: string,
  load: () => Promise<readonly string[]>,
): CatalogSource<readonly string[]> {
  return { id, name: id.toUpperCase(), load };
}

const down = async (): Promise<readonly string[]> => {
  throw new Error("down");
};

describe("walkCatalogSources", () => {
  test("a healthy primary answers and is recorded as primary", async () => {
    let standInCalls = 0;
    const answer = await walkCatalogSources({
      capability: "calendar",
      lane: "movie-series",
      sources: [
        source("tmdb", async () => ["a"]),
        source("tvmaze", async () => {
          standInCalls += 1;
          return ["b"];
        }),
      ],
    });
    expect(answer).toMatchObject({ value: ["a"], sourceId: "tmdb", fallback: false });
    expect(standInCalls).toBe(0);
    expect(catalogAnswersSnapshot()).toMatchObject([{ sourceId: "tmdb", fallback: false }]);
  });

  test("a failed primary hands over, and the ledger says why", async () => {
    const answer = await walkCatalogSources({
      capability: "calendar",
      lane: "movie-series",
      sources: [source("tmdb", down), source("tvmaze", async () => ["b"])],
    });
    expect(answer).toMatchObject({ value: ["b"], sourceId: "tvmaze", fallback: true });
    expect(catalogAnswersSnapshot()).toMatchObject([
      { sourceId: "tvmaze", fallback: true, reason: "TMDB unavailable" },
    ]);
  });

  test("everything down rejects with the primary's error", async () => {
    await expect(
      walkCatalogSources({
        capability: "calendar",
        lane: "movie-series",
        sources: [
          source("tmdb", async () => {
            throw new Error("tmdb down");
          }),
          source("tvmaze", down),
        ],
      }),
    ).rejects.toThrow("tmdb down");
  });

  test("a caller abort propagates and never reaches a stand-in", async () => {
    const controller = new AbortController();
    let standInCalls = 0;
    await expect(
      walkCatalogSources({
        capability: "calendar",
        lane: "movie-series",
        signal: controller.signal,
        sources: [
          source("tmdb", async () => {
            controller.abort();
            throw new DOMException("The operation was aborted.", "AbortError");
          }),
          source("tvmaze", async () => {
            standInCalls += 1;
            return ["b"];
          }),
        ],
      }),
    ).rejects.toThrow();
    expect(standInCalls).toBe(0);
  });

  test("a stand-in that failed is skipped for the breaker window, then retried", async () => {
    let now = 0;
    resetCatalogSourceBreakersForTest(() => now);
    let standInCalls = 0;
    const walk = () =>
      walkCatalogSources({
        capability: "calendar",
        lane: "movie-series",
        sources: [
          source("tmdb", down),
          source("tvmaze", async () => {
            standInCalls += 1;
            throw new Error("tvmaze down");
          }),
        ],
      });
    await expect(walk()).rejects.toThrow("down");
    await expect(walk()).rejects.toThrow("down");
    expect(standInCalls).toBe(1);
    now += CATALOG_FALLBACK_BREAKER_MS + 1;
    await expect(walk()).rejects.toThrow("down");
    expect(standInCalls).toBe(2);
  });

  test("an empty answer that hands over is still returned when every stand-in fails", async () => {
    const answer = await walkCatalogSources({
      capability: "trending",
      lane: "anime",
      handsOver: (value) => value.length === 0,
      sources: [source("anilist", async () => []), source("kitsu", down)],
    });
    expect(answer).toMatchObject({ value: [], sourceId: "anilist", fallback: false });
  });
});
