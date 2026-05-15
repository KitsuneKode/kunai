import { describe, expect, test } from "bun:test";

import { parseSearchIntentText } from "@/domain/search/SearchIntentParser";

describe("SearchIntentParser", () => {
  test("parses query text and key-value filters", () => {
    expect(parseSearchIntentText("Dune year:2021 downloaded:true provider:vidking")).toEqual({
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
    expect(parseSearchIntentText("anime year:2010..2020 genre:action")).toEqual({
      query: "anime",
      filters: {
        year: { from: 2010, to: 2020 },
      },
      sort: undefined,
      mode: undefined,
      errors: [{ key: "genre", value: "action", reason: "unsupported-filter" }],
    });
  });

  test("parses mode, watched, release, and sort filters", () => {
    expect(
      parseSearchIntentText("new stuff mode:anime watched:watching release:this-week sort:recent"),
    ).toEqual({
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
});
