import { describe, expect, test } from "bun:test";

import { buildDiscoverSections } from "@/app/discover/discover-sections";
import type { SearchResult } from "@/domain/types";

const result = (id: string, title = id): SearchResult => ({
  id,
  type: "series",
  title,
  year: "2024",
  overview: "",
  posterPath: null,
});

const finished = (titleId: string, title: string, providerId: string, updatedAt: string) => ({
  key: `${titleId}:1:1`,
  titleId,
  title,
  mediaKind: providerId === "allanime" ? "anime" : "series",
  season: 1,
  episode: 1,
  positionSeconds: 1200,
  durationSeconds: 1200,
  completed: true,
  providerId,
  createdAt: updatedAt,
  updatedAt,
});

function container(mode: "anime" | "series", history: readonly ReturnType<typeof finished>[]) {
  const tmdbAsked: string[] = [];
  return {
    tmdbAsked,
    // SAFETY: buildDiscoverSections reads only these members.
    value: {
      historyRepository: { listLatestByTitle: () => history },
      stateManager: { getState: () => ({ mode }) },
      providerRegistry: {
        getAll: () => [
          { metadata: { id: "allanime", isAnimeProvider: true } },
          { metadata: { id: "vidking", isAnimeProvider: false } },
        ],
      },
      recommendationService: {
        getForTitle: async (id: string) => {
          tmdbAsked.push(id);
          return { label: "", reason: "similar" as const, items: [result("tmdb-rec")] };
        },
        getPersonalizedByHistory: async () => ({
          label: "",
          reason: "genre-affinity" as const,
          items: [],
        }),
      },
    } as never,
  };
}

const loaders = (similar: Record<string, readonly SearchResult[]>) => ({
  trending: async () => ({ results: [result("trend")], sourceId: "test" }),
  animeSimilar: async (id: string) => [...(similar[id] ?? [])],
});

// Neon features review #11: anime Discover had only a trending rail.
describe("anime Discover personal rails", () => {
  test("because-you-watched and watch-pattern come from AniList similar titles", async () => {
    const fixture = container("anime", [
      finished("21", "Frieren", "allanime", "2026-02-02T00:00:00.000Z"),
      finished("30", "Dandadan", "allanime", "2026-02-01T00:00:00.000Z"),
    ]);
    const sections = await buildDiscoverSections(fixture.value, {
      loaders: loaders({
        "21": [result("100", "Like Frieren"), result("30", "Dandadan")],
        "30": [result("200", "Like Dandadan")],
      }),
    });

    expect(sections.map((section) => section.label)).toEqual([
      "Because you watched Frieren",
      "Anime trending this week",
      "From your watch pattern",
    ]);
    // Titles already in history are not recommended back.
    expect(sections[0]?.items.map((item) => item.id)).toEqual(["100"]);
    expect(sections[2]?.items.map((item) => item.id)).toEqual(["200"]);
  });

  test("series mode anchors on the newest finished series, not a newer anime", async () => {
    const fixture = container("series", [
      finished("21", "Frieren", "allanime", "2026-02-02T00:00:00.000Z"),
      finished("1396", "Breaking Bad", "vidking", "2026-02-01T00:00:00.000Z"),
    ]);
    const sections = await buildDiscoverSections(fixture.value, { loaders: loaders({}) });

    expect(sections[0]?.label).toBe("Because you watched Breaking Bad");
    expect(fixture.tmdbAsked).toEqual(["1396"]);
  });
});
