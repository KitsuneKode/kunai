import { describe, expect, test } from "bun:test";

import {
  ARTWORK_PREFERENCE,
  type ArtworkCandidate,
  episodeThumbKey,
  mergeArtwork,
} from "@/domain/catalog/title-detail";

describe("episodeThumbKey", () => {
  test("stable season.episode key", () => {
    expect(episodeThumbKey(4, 7)).toBe("4.7");
    expect(episodeThumbKey(1, 12)).toBe("1.12");
  });
});

describe("mergeArtwork", () => {
  test("scalars take the first non-empty value in preference order", () => {
    const candidates: ArtworkCandidate[] = [
      { source: "provider", poster: "provider-poster", backdrop: "provider-bd" },
      { source: "tmdb", poster: "tmdb-poster" },
      { source: "anilist", poster: "anilist-poster", backdrop: "anilist-bd" },
    ];
    const merged = mergeArtwork(candidates, ARTWORK_PREFERENCE.anime); // anilist > tmdb > tvdb > provider
    expect(merged.poster).toBe("anilist-poster");
    // anilist has a backdrop, so it wins even though provider also has one
    expect(merged.backdrop).toBe("anilist-bd");
  });

  test("falls back to a less-preferred source when the preferred lacks a field", () => {
    const candidates: ArtworkCandidate[] = [
      { source: "anilist", poster: "anilist-poster" }, // no backdrop
      { source: "tmdb", backdrop: "tmdb-bd" },
    ];
    const merged = mergeArtwork(candidates, ARTWORK_PREFERENCE.anime);
    expect(merged.poster).toBe("anilist-poster");
    expect(merged.backdrop).toBe("tmdb-bd");
  });

  test("keyed maps merge per-key: preferred wins, others back-fill", () => {
    const candidates: ArtworkCandidate[] = [
      { source: "tmdb", seasonPosters: { 1: "tmdb-s1", 2: "tmdb-s2" } },
      { source: "anilist", seasonPosters: { 1: "anilist-s1", 3: "anilist-s3" } },
    ];
    // series preference: tmdb > tvdb > anilist > provider
    const merged = mergeArtwork(candidates, ARTWORK_PREFERENCE.series);
    expect(merged.seasonPosters).toEqual({
      1: "tmdb-s1", // tmdb preferred over anilist for the shared key
      2: "tmdb-s2",
      3: "anilist-s3", // back-filled from anilist (tmdb lacked it)
    });
  });

  test("episode thumbnails merge by season.episode key", () => {
    const candidates: ArtworkCandidate[] = [
      { source: "tvdb", episodeThumbnails: { [episodeThumbKey(1, 1)]: "tvdb-1-1" } },
      {
        source: "tmdb",
        episodeThumbnails: {
          [episodeThumbKey(1, 1)]: "tmdb-1-1",
          [episodeThumbKey(1, 2)]: "tmdb-1-2",
        },
      },
    ];
    const merged = mergeArtwork(candidates, ARTWORK_PREFERENCE.series);
    expect(merged.episodeThumbnails).toEqual({
      "1.1": "tmdb-1-1", // tmdb preferred
      "1.2": "tmdb-1-2",
    });
  });

  test("records contributing sources in preference order; omits empty fields", () => {
    const candidates: ArtworkCandidate[] = [
      { source: "provider" }, // contributes nothing
      { source: "tmdb", poster: "tmdb-poster" },
    ];
    const merged = mergeArtwork(candidates, ARTWORK_PREFERENCE.series);
    expect(merged.poster).toBe("tmdb-poster");
    expect(merged.contributingSources).toEqual(["tmdb"]);
    expect(merged.backdrop).toBeUndefined();
    expect(merged.seasonPosters).toBeUndefined();
    expect(merged.episodeThumbnails).toBeUndefined();
  });

  test("empty input yields an empty set", () => {
    expect(mergeArtwork([])).toEqual({});
  });
});
