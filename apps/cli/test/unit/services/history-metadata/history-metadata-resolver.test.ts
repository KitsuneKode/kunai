import { describe, expect, it } from "bun:test";

import type { SearchResult } from "@/domain/types";
import { createHistoryMetadataResolver } from "@/services/history-metadata/create-history-metadata-resolver";
import type { HistoryHealTarget } from "@/services/history-metadata/select-heal-targets";

function target(over: Partial<HistoryHealTarget> & { title: string }): HistoryHealTarget {
  return {
    titleId: over.titleId ?? "t1",
    mediaKind: over.mediaKind ?? "anime",
    needsPoster: over.needsPoster ?? true,
    needsExternalIds: over.needsExternalIds ?? true,
    ...over,
  };
}

function result(over: Partial<SearchResult> & { title: string }): SearchResult {
  return {
    id: over.id ?? "r1",
    type: "series",
    year: "2024",
    overview: "",
    posterPath: over.posterPath ?? null,
    ...over,
  } as SearchResult;
}

describe("createHistoryMetadataResolver", () => {
  it("resolves poster (TMDB relative path → URL) and external ids on a title match", async () => {
    const resolver = createHistoryMetadataResolver({
      search: async () => [
        result({
          title: "Barakamon",
          posterPath: "/abc.jpg",
          externalIds: { anilistId: "103223" },
        }),
      ],
    });
    const resolved = await resolver.resolve(target({ title: "Barakamon" }));
    expect(resolved).toEqual({
      posterUrl: "https://image.tmdb.org/t/p/w342/abc.jpg",
      externalIds: { anilistId: "103223" },
    });
  });

  it("keeps an absolute poster url as-is", async () => {
    const resolver = createHistoryMetadataResolver({
      search: async () => [result({ title: "Barakamon", posterPath: "https://cdn/x.jpg" })],
    });
    const resolved = await resolver.resolve(target({ title: "Barakamon" }));
    expect(resolved?.posterUrl).toBe("https://cdn/x.jpg");
  });

  it("matches across minor title differences (sequel suffix)", async () => {
    const resolver = createHistoryMetadataResolver({
      search: async () => [result({ title: "Bungo Stray Dogs", posterPath: "/b.jpg" })],
    });
    const resolved = await resolver.resolve(target({ title: "Bungo Stray Dogs 3" }));
    expect(resolved?.posterUrl).toBe("https://image.tmdb.org/t/p/w342/b.jpg");
  });

  it("returns null when no result is a plausible title match (avoids wrong backfill)", async () => {
    const resolver = createHistoryMetadataResolver({
      search: async () => [result({ title: "Completely Different Show", posterPath: "/x.jpg" })],
    });
    expect(await resolver.resolve(target({ title: "Barakamon" }))).toBeNull();
  });

  it("returns null when search yields nothing", async () => {
    const resolver = createHistoryMetadataResolver({ search: async () => [] });
    expect(await resolver.resolve(target({ title: "Barakamon" }))).toBeNull();
  });
});
