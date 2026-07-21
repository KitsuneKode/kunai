import { describe, expect, it } from "bun:test";

import {
  PostPlaybackRecommendationRail,
  type PostPlaybackRecommendationItem,
} from "@/app/post-play/post-playback-recommendations";
import type { SearchResult, TitleInfo } from "@/domain/types";

const TITLE = { id: "tt1", name: "My Show", type: "series" } as TitleInfo;

function makeContainer(railEnabled = true) {
  const records: Array<{ operation?: string }> = [];
  const container = {
    config: { recommendationRailEnabled: railEnabled },
    diagnosticsService: {
      record: (entry: { operation?: string }) => {
        records.push(entry);
      },
    },
  } as never;
  return { container, records };
}

function item(id: string): PostPlaybackRecommendationItem {
  return { id, type: "series", title: `Title ${id}` };
}

function seed(id: string): SearchResult {
  return { id, type: "series", title: `Title ${id}` } as SearchResult;
}

describe("PostPlaybackRecommendationRail", () => {
  it("returns the prefetched seed without loading when the seed is non-empty", async () => {
    const { container } = makeContainer();
    let loadCalls = 0;
    const rail = new PostPlaybackRecommendationRail({
      container,
      title: TITLE,
      budgetMs: 250,
      load: async () => {
        loadCalls += 1;
        return [item("live")];
      },
    });
    const items = await rail.resolveRailItems({
      mode: "series",
      prefetchedItems: [seed("a"), seed("b")],
      autoContinueIntoRecommendationPossible: false,
    });
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(loadCalls).toBe(0);
    expect(rail.attempted).toBe(false);
  });

  it("blocks for a live load when an auto-continue decision needs it", async () => {
    const { container } = makeContainer();
    const rail = new PostPlaybackRecommendationRail({
      container,
      title: TITLE,
      budgetMs: 250,
      load: async () => [item("x"), item("y")],
    });
    const items = await rail.resolveRailItems({
      mode: "series",
      prefetchedItems: null,
      autoContinueIntoRecommendationPossible: true,
    });
    expect(items.map((i) => i.id)).toEqual(["x", "y"]);
    expect(rail.attempted).toBe(true);
  });

  it("returns an empty list when the blocking load exceeds the budget", async () => {
    const { container } = makeContainer();
    const rail = new PostPlaybackRecommendationRail({
      container,
      title: TITLE,
      budgetMs: 50,
      // Never resolves; the injected sleep wins the race deterministically.
      load: () => new Promise<readonly PostPlaybackRecommendationItem[]>(() => {}),
      sleep: async () => {},
    });
    const items = await rail.resolveRailItems({
      mode: "series",
      prefetchedItems: null,
      autoContinueIntoRecommendationPossible: true,
    });
    expect(items).toEqual([]);
    expect(rail.attempted).toBe(true);
  });

  it("upgrades a timed-out block load in the background without a second fetch", async () => {
    const { container } = makeContainer();
    let resolveLoad: ((items: readonly PostPlaybackRecommendationItem[]) => void) | undefined;
    let loadCalls = 0;
    let notified = 0;
    const rail = new PostPlaybackRecommendationRail({
      container,
      title: TITLE,
      budgetMs: 50,
      load: () => {
        loadCalls += 1;
        return new Promise<readonly PostPlaybackRecommendationItem[]>((resolve) => {
          resolveLoad = resolve;
        });
      },
      sleep: async () => {},
    });
    rail.subscribe(() => {
      notified += 1;
    });

    const first = await rail.resolveRailItems({
      mode: "series",
      prefetchedItems: null,
      autoContinueIntoRecommendationPossible: true,
    });
    expect(first).toEqual([]);
    expect(rail.attempted).toBe(true);
    expect(rail.loadedItems).toBeNull();
    expect(loadCalls).toBe(1);

    resolveLoad?.([item("late1"), item("late2")]);
    await Promise.resolve();
    await Promise.resolve();

    expect(notified).toBe(1);
    expect(rail.loadedItems?.map((i) => i.id)).toEqual(["late1", "late2"]);

    const second = await rail.resolveRailItems({
      mode: "series",
      prefetchedItems: null,
      autoContinueIntoRecommendationPossible: true,
    });
    expect(second.map((i) => i.id)).toEqual(["late1", "late2"]);
    expect(loadCalls).toBe(1);
  });

  it("loads in the background and surfaces the items on a later iteration", async () => {
    const { container } = makeContainer();
    let resolveLoad: ((items: readonly PostPlaybackRecommendationItem[]) => void) | undefined;
    let loadCalls = 0;
    const rail = new PostPlaybackRecommendationRail({
      container,
      title: TITLE,
      budgetMs: 250,
      load: () => {
        loadCalls += 1;
        return new Promise<readonly PostPlaybackRecommendationItem[]>((resolve) => {
          resolveLoad = resolve;
        });
      },
    });

    // First pass: empty seed, no auto-continue → background load, paints empty now.
    const first = await rail.resolveRailItems({
      mode: "series",
      prefetchedItems: null,
      autoContinueIntoRecommendationPossible: false,
    });
    expect(first).toEqual([]);
    expect(loadCalls).toBe(1);

    // Background load resolves; flush the .then microtask.
    resolveLoad?.([item("bg1"), item("bg2")]);
    await Promise.resolve();
    await Promise.resolve();

    // Later iteration picks up the cached items and does not re-load.
    const second = await rail.resolveRailItems({
      mode: "series",
      prefetchedItems: null,
      autoContinueIntoRecommendationPossible: false,
    });
    expect(second.map((i) => i.id)).toEqual(["bg1", "bg2"]);
    expect(loadCalls).toBe(1);
  });

  it("skips loading entirely when the rail is disabled", async () => {
    const { container } = makeContainer(false);
    let loadCalls = 0;
    const rail = new PostPlaybackRecommendationRail({
      container,
      title: TITLE,
      budgetMs: 250,
      load: async () => {
        loadCalls += 1;
        return [item("x")];
      },
    });
    const items = await rail.resolveRailItems({
      mode: "series",
      prefetchedItems: [seed("a")],
      autoContinueIntoRecommendationPossible: true,
    });
    expect(items).toEqual([]);
    expect(loadCalls).toBe(0);
  });
});
