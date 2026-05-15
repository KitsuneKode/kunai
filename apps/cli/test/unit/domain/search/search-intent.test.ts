import { describe, expect, test } from "bun:test";

import { normalizeSearchIntent } from "@/domain/search/SearchIntent";

describe("SearchIntent", () => {
  test("normalizes empty optional filters without changing query", () => {
    expect(
      normalizeSearchIntent({
        query: "Dune",
        mode: "series",
        filters: {},
      }),
    ).toEqual({
      query: "Dune",
      mode: "series",
      filters: {},
      sort: "relevance",
    });
  });

  test("clamps unsupported year ranges into ordered ranges", () => {
    expect(
      normalizeSearchIntent({
        query: "crime",
        mode: "all",
        filters: { year: { from: 2022, to: 1999 } },
      }).filters.year,
    ).toEqual({ from: 1999, to: 2022 });
  });
});
