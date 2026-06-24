import { describe, expect, it } from "bun:test";

import { buildShareRefFromTitleContext } from "@/app/share-ref-from-context";
import { encodePlaybackTargetRef } from "@/domain/share/playback-target-ref";

describe("buildShareRefFromTitleContext", () => {
  it("prefers AniList catalog anchors for anime titles", () => {
    const ref = buildShareRefFromTitleContext({
      mode: "anime",
      title: {
        id: "anilist:21",
        type: "series",
        name: "One Piece",
        externalIds: { anilistId: "21" },
      },
      episode: { season: 1, episode: 1 },
      startSeconds: 90,
      providerId: "allanime",
    });
    expect(ref).toEqual({
      anchor: { by: "catalog", ns: "anilist", id: "21" },
      kind: "anime",
      season: 1,
      episode: 1,
      startSeconds: 90,
      title: "One Piece",
      hint: { providerId: "allanime" },
    });
    expect(encodePlaybackTargetRef(ref!)).toContain("cat=anilist%3A21");
  });

  it("normalizes imdb ids without a duplicate tt prefix", () => {
    const ref = buildShareRefFromTitleContext({
      mode: "series",
      title: {
        id: "imdb:tt0903747",
        type: "movie",
        name: "Breaking Bad",
        externalIds: { imdbId: "tt0903747" },
      },
    });
    expect(ref?.anchor).toEqual({ by: "catalog", ns: "imdb", id: "tt0903747" });
    expect(ref?.kind).toBe("movie");
  });

  it("falls back to search when no portable catalog id exists", () => {
    const ref = buildShareRefFromTitleContext({
      mode: "anime",
      title: {
        id: "provider-native:abc",
        type: "series",
        name: "Mystery Anime",
      },
    });
    expect(ref).toEqual({
      anchor: { by: "search", query: "Mystery Anime" },
      kind: "anime",
      title: "Mystery Anime",
    });
  });

  it("parses tmdb ids from title ids when externalIds are missing", () => {
    const ref = buildShareRefFromTitleContext({
      mode: "series",
      title: {
        id: "tmdb:1396",
        type: "series",
        name: "Breaking Bad",
      },
    });
    expect(ref?.anchor).toEqual({ by: "catalog", ns: "tmdb", id: "1396" });
  });

  it("returns null when there is no anchor and no searchable title", () => {
    expect(
      buildShareRefFromTitleContext({
        mode: "series",
        title: { id: "unknown:1", type: "series", name: "" },
      }),
    ).toBeNull();
  });
});
