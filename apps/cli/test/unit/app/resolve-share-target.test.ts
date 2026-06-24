import { describe, expect, it } from "bun:test";

import { resolveShareTarget, shareTitleCatalogIdForAnimeMapping } from "@/app/resolve-share-target";
import type { Container } from "@/container";
import type { TitleInfo } from "@/domain/types";

import { createContainerFixture } from "../../support/container-fixture";

function createResolverContainer(
  overrides: {
    readonly providerId?: string;
    readonly animeProvider?: string;
    readonly isAnimeProvider?: boolean;
    readonly availableProviders?: readonly string[];
  } = {},
): Container {
  const providerId = overrides.providerId ?? "videasy";
  const available = new Set(overrides.availableProviders ?? [providerId, "allanime"]);
  const base = createContainerFixture({
    config: {
      animeProvider: overrides.animeProvider ?? "allanime",
      animeLanguageProfile: { audio: "ja", subtitle: "en" },
    } as Container["config"],
    providerRegistry: {
      get: (id: string) =>
        available.has(id)
          ? {
              metadata: {
                id,
                isAnimeProvider:
                  id === "allanime" || (id === providerId && overrides.isAnimeProvider === true),
              },
              capabilities: {} as never,
              canHandle: () => true,
              resolveStream: async () => null,
              search: async () => [],
            }
          : null,
    } as unknown as Container["providerRegistry"],
    stateManager: {
      getState: () => ({
        provider: providerId,
        mode: overrides.isAnimeProvider || providerId === "allanime" ? "anime" : "series",
      }),
      dispatch: () => {},
      subscribe: () => () => {},
    } as unknown as Container["stateManager"],
  });
  return base.container;
}

describe("shareTitleCatalogIdForAnimeMapping", () => {
  it("prefers external anilist ids over prefixed title ids", () => {
    const title: TitleInfo = {
      id: "anilist:21",
      type: "series",
      name: "One Piece",
      externalIds: { anilistId: "21" },
      isAnime: true,
    };
    expect(shareTitleCatalogIdForAnimeMapping(title)).toBe("21");
  });

  it("strips catalog namespace prefixes when external ids are missing", () => {
    expect(
      shareTitleCatalogIdForAnimeMapping({
        id: "mal:21",
        type: "series",
        name: "Test",
      }),
    ).toBe("21");
  });
});

describe("resolveShareTarget", () => {
  it("maps a tmdb series catalog anchor to a portable TitleInfo", async () => {
    const container = createResolverContainer();
    const out = await resolveShareTarget(
      {
        anchor: { by: "catalog", ns: "tmdb", id: "1399" },
        kind: "series",
        season: 2,
        episode: 5,
        startSeconds: 90,
      },
      container,
    );
    expect(out.title.id).toBe("tmdb:1399");
    expect(out.title.externalIds?.tmdbId).toBe("1399");
    expect(out.episode).toEqual({ season: 2, episode: 5 });
    expect(out.startSeconds).toBe(90);
    expect(out.mode).toBe("series");
  });

  it("maps movie and imdb catalog anchors", async () => {
    const container = createResolverContainer();
    const out = await resolveShareTarget(
      {
        anchor: { by: "catalog", ns: "imdb", id: "tt1375666" },
        kind: "movie",
        title: "Inception",
      },
      container,
    );
    expect(out.title.type).toBe("movie");
    expect(out.title.externalIds?.imdbId).toBe("tt1375666");
    expect(out.mode).toBe("series");
  });

  it("maps absoluteEpisode to a synthetic season 1 episode", async () => {
    const container = createResolverContainer({ providerId: "allanime", isAnimeProvider: true });
    const out = await resolveShareTarget(
      {
        anchor: { by: "catalog", ns: "anilist", id: "21" },
        kind: "anime",
        absoluteEpisode: 1075,
      },
      container,
    );
    expect(out.episode).toEqual({ season: 1, episode: 1075 });
  });

  it("falls back to search anchor with auto-pick", async () => {
    const container = createResolverContainer({ isAnimeProvider: true });
    const out = await resolveShareTarget(
      { anchor: { by: "search", query: "naruto" }, kind: "anime" },
      container,
    );
    expect(out.searchQuery).toBe("naruto");
    expect(out.autoPickIndex).toBe(1);
    expect(out.mode).toBe("anime");
    expect(out.title.isAnime).toBe(true);
  });

  it("notes when a shared provider hint is unavailable", async () => {
    const container = createResolverContainer();
    const out = await resolveShareTarget(
      {
        anchor: { by: "catalog", ns: "tmdb", id: "1399" },
        kind: "series",
        hint: { providerId: "missing-provider" },
      },
      container,
    );
    expect(out.note).toContain("missing-provider");
  });

  it("rejects a non-anime provider hint for anime refs", async () => {
    const container = createResolverContainer({ availableProviders: ["videasy", "allanime"] });
    const out = await resolveShareTarget(
      {
        anchor: { by: "catalog", ns: "anilist", id: "21" },
        kind: "anime",
        hint: { providerId: "videasy" },
      },
      container,
    );
    expect(out.note).toContain("not an anime provider");
  });

  it("preserves portable catalog ids when anime mapping returns the same id", async () => {
    const container = createResolverContainer({ providerId: "allanime", isAnimeProvider: true });
    const out = await resolveShareTarget(
      {
        anchor: { by: "catalog", ns: "anilist", id: "21" },
        kind: "anime",
        title: "One Piece",
      },
      container,
    );
    expect(out.title.externalIds?.anilistId).toBe("21");
    expect(out.mode).toBe("anime");
    expect(shareTitleCatalogIdForAnimeMapping(out.title)).toBe("21");
  });

  it("marks download action on resolved targets", async () => {
    const container = createResolverContainer();
    const out = await resolveShareTarget(
      {
        anchor: { by: "catalog", ns: "tmdb", id: "438631" },
        kind: "movie",
      },
      container,
      { action: "download" },
    );
    expect(out.download).toBe(true);
    expect(out.title.type).toBe("movie");
  });
});
