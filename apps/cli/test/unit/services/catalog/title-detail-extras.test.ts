import { describe, expect, it } from "bun:test";

import {
  aniListExternalLinks,
  tmdbExternalLinks,
  toTrailerUrl,
} from "@/services/catalog/title-detail-extras";

describe("toTrailerUrl", () => {
  it("builds a youtube watch url", () => {
    expect(toTrailerUrl({ site: "youtube", id: "abc123" })).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );
  });
  it("builds a dailymotion url", () => {
    expect(toTrailerUrl({ site: "dailymotion", id: "x99" })).toBe(
      "https://www.dailymotion.com/video/x99",
    );
  });
  it("returns undefined for unknown site or missing id", () => {
    expect(toTrailerUrl({ site: "vimeo", id: "1" })).toBeUndefined();
    expect(toTrailerUrl({ site: "youtube", id: "" })).toBeUndefined();
    expect(toTrailerUrl(null)).toBeUndefined();
  });
});

describe("aniListExternalLinks", () => {
  it("maps site/url links and appends a MAL link from idMal", () => {
    const links = aniListExternalLinks(
      [
        { site: "Official Site", url: "https://show.example" },
        { site: "Crunchyroll", url: "https://cr.example/show" },
      ],
      "5114",
    );
    expect(links).toEqual([
      { label: "Official Site", url: "https://show.example" },
      { label: "Crunchyroll", url: "https://cr.example/show" },
      { label: "MyAnimeList", url: "https://myanimelist.net/anime/5114" },
    ]);
  });
  it("dedupes, skips blanks, and omits MAL when no idMal", () => {
    expect(aniListExternalLinks([{ site: "", url: "" }], undefined)).toEqual([]);
  });
});

describe("tmdbExternalLinks", () => {
  it("builds homepage + imdb links", () => {
    expect(tmdbExternalLinks("https://site.example", "tt123")).toEqual([
      { label: "Website", url: "https://site.example" },
      { label: "IMDb", url: "https://www.imdb.com/title/tt123/" },
    ]);
  });
  it("returns only what exists", () => {
    expect(tmdbExternalLinks(undefined, undefined)).toEqual([]);
    expect(tmdbExternalLinks(undefined, "tt9")).toEqual([
      { label: "IMDb", url: "https://www.imdb.com/title/tt9/" },
    ]);
  });
});
