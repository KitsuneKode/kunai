import { afterEach, describe, expect, test } from "bun:test";

import {
  clearAllMangaProviderCachesForTest,
  fetchAllMangaEpisodeCatalog,
} from "../src/allmanga/api-client";
import {
  allMangaEpisodeMetadataCacheKey,
  clearAnimeMetadataCacheForTest,
  seedEpisodeMetadataFromProvider,
  type AnimeEpisodeMetadata,
} from "../src/shared/anime-metadata";

const FIXTURE_BASE = new URL("./fixtures/allmanga/", import.meta.url);

afterEach(() => {
  clearAllMangaProviderCachesForTest();
  clearAnimeMetadataCacheForTest();
});

describe("AllManga episode metadata handoff", () => {
  test("listEpisodes catalog uses seeded provider metadata and skips AniList/Jikan", async () => {
    const catalogPayload = await Bun.file(new URL("catalog-response.json", FIXTURE_BASE)).json();
    const showId = "show-metadata-handoff";
    const mode = "sub" as const;
    const subEpisodes = catalogPayload.data.show.availableEpisodesDetail.sub as string[];
    const seeded: AnimeEpisodeMetadata[] = subEpisodes.map((detail, index) => ({
      number: index + 1,
      title: `Provider note for episode ${detail}`,
      source: "allmanga",
    }));
    seedEpisodeMetadataFromProvider(allMangaEpisodeMetadataCacheKey(showId, mode), seeded);

    const externalHosts: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("graphql.anilist.co") || url.includes("api.jikan.moe")) {
        externalHosts.push(url);
        return new Response("unexpected external metadata fetch", { status: 500 });
      }
      return new Response(JSON.stringify(catalogPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const episodes = await fetchAllMangaEpisodeCatalog({
        apiUrl: "https://api.allanime.day/api",
        referer: "https://youtu-chan.com",
        ua: "Mozilla/5.0",
        showId,
        mode,
      });

      expect(externalHosts).toHaveLength(0);
      expect(episodes).toHaveLength(subEpisodes.length);
      expect(episodes[0]?.label).toContain("Provider note for episode 1");
      expect(episodes[1]?.label).toContain("Provider note for episode 2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("listEpisodes catalog falls back to external metadata when seeded coverage is sparse", async () => {
    const catalogPayload = await Bun.file(new URL("catalog-response.json", FIXTURE_BASE)).json();
    const showId = "show-metadata-sparse";
    const mode = "sub" as const;

    seedEpisodeMetadataFromProvider(allMangaEpisodeMetadataCacheKey(showId, mode), [
      { number: 1, title: "Only first episode titled", source: "allmanga" },
    ]);

    let anilistCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("graphql.anilist.co")) {
        anilistCalled = true;
        return new Response(
          JSON.stringify({
            data: {
              Media: {
                streamingEpisodes: [
                  { title: "AniList ep 1", thumbnail: null },
                  { title: "AniList ep 2", thumbnail: null },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("api.jikan.moe")) {
        return new Response(JSON.stringify({ data: [], pagination: { has_next_page: false } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(catalogPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const episodes = await fetchAllMangaEpisodeCatalog({
        apiUrl: "https://api.allanime.day/api",
        referer: "https://youtu-chan.com",
        ua: "Mozilla/5.0",
        showId,
        mode,
      });

      expect(anilistCalled).toBe(true);
      expect(episodes[0]?.label).toContain("Only first episode titled");
      expect(episodes[1]?.label).toContain("AniList ep 2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
