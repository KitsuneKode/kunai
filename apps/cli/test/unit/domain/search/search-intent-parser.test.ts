import { describe, expect, test } from "bun:test";

import { parseSearchIntentText } from "@/domain/search/SearchIntentParser";

describe("SearchIntentParser", () => {
  test("parses query text and key-value filters", () => {
    expect(parseSearchIntentText("Dune year:2021 downloaded:true provider:vidking")).toMatchObject({
      query: "Dune",
      filters: {
        year: 2021,
        downloaded: true,
        provider: "vidking",
      },
      sort: undefined,
      mode: undefined,
      errors: [],
    });
  });

  test("parses ranges and leaves unknown filters as non-blocking errors", () => {
    expect(parseSearchIntentText("anime year:2010..2020 genre:action")).toMatchObject({
      query: "anime",
      filters: {
        year: { from: 2010, to: 2020 },
        genres: ["action"],
      },
      sort: undefined,
      mode: undefined,
      errors: [],
    });
  });

  test("parses browse-class filters in the shared intent parser", () => {
    expect(parseSearchIntentText("breaking bad type:series rating:9 min:8.5")).toMatchObject({
      query: "breaking bad",
      filters: { type: "series", minRating: 8.5 },
      filterState: { query: "breaking bad", type: "series", minRating: 8.5 },
      sort: undefined,
      mode: undefined,
      errors: [],
    });
  });

  test("parses mode, watched, release, and sort filters", () => {
    expect(
      parseSearchIntentText("new stuff mode:anime watched:watching release:this-week sort:recent"),
    ).toMatchObject({
      query: "new stuff",
      filters: {
        watched: "watching",
        release: "this-week",
      },
      sort: "recent",
      mode: "anime",
      errors: [],
    });
  });

  test("parses audio and subtitle filters into the shared filter state", () => {
    expect(parseSearchIntentText("show audio:ja subtitles:en provider:allanime")).toMatchObject({
      query: "show",
      filters: {
        audio: "ja",
        subtitles: "en",
        provider: "allanime",
      },
      filterState: {
        query: "show",
        audio: "ja",
        subtitles: "en",
        provider: "allanime",
      },
      errors: [],
    });
  });

  test("parses catalog sorts used by advanced search", () => {
    expect(parseSearchIntentText("genre:thriller sort:popular")).toMatchObject({
      query: "",
      filters: {
        genres: ["thriller"],
      },
      sort: "popular",
      errors: [],
    });

    expect(parseSearchIntentText("rating:8 sort:rating")).toMatchObject({
      query: "",
      filters: {
        minRating: 8,
      },
      sort: "rating",
      errors: [],
    });
  });
});
