import { describe, expect, test } from "bun:test";

import {
  filterResultsByQueryWords,
  longestWordFallbackQuery,
  searchWithPhraseFallback,
} from "../src/shared/search-fallback";

type Row = { readonly title: string; readonly alt?: string };

const namesOf = (row: Row) => [row.title, row.alt];

describe("longestWordFallbackQuery", () => {
  test("returns the longest word for a multiword query", () => {
    expect(longestWordFallbackQuery("cyberpunk edge runners")).toBe("cyberpunk");
  });

  test("returns null for a single-word query — nothing wider to try", () => {
    expect(longestWordFallbackQuery("naruto")).toBeNull();
    expect(longestWordFallbackQuery("  ")).toBeNull();
  });
});

describe("filterResultsByQueryWords", () => {
  const rows: readonly Row[] = [
    { title: "Cyberpunk: Edgerunners" },
    { title: "Cyberpunk, Lord of Immortals" },
    { title: "Edgerunner Tales", alt: "Cyberpunk Edge Runners" },
    { title: "Sword Art Online" },
  ];

  test("keeps rows containing every query word across their names", () => {
    const kept = filterResultsByQueryWords(rows, "cyberpunk edge runners", namesOf);
    expect(kept.map((row) => row.title)).toEqual(["Cyberpunk: Edgerunners", "Edgerunner Tales"]);
  });

  test("ignores punctuation and case differences", () => {
    const kept = filterResultsByQueryWords(rows, "cyberpunk: edgerunners", namesOf);
    expect(kept.map((row) => row.title)).toEqual(["Cyberpunk: Edgerunners"]);
  });

  test("returns rows untouched when the query normalizes to nothing", () => {
    expect(filterResultsByQueryWords(rows, "   ", namesOf)).toEqual(rows);
  });
});

describe("searchWithPhraseFallback", () => {
  test("returns the literal results without a second fetch", async () => {
    const queries: string[] = [];
    const results = await searchWithPhraseFallback(
      "naruto",
      async (q) => {
        queries.push(q);
        return [{ title: "Naruto" }];
      },
      namesOf,
    );
    expect(results).toEqual([{ title: "Naruto" }]);
    expect(queries).toEqual(["naruto"]);
  });

  test("retries a miss with the longest word and filters the wider set", async () => {
    const queries: string[] = [];
    const results = await searchWithPhraseFallback(
      "cyberpunk edge runners",
      async (q) => {
        queries.push(q);
        if (q === "cyberpunk edge runners") return [];
        return [{ title: "Cyberpunk: Edgerunners" }, { title: "Cyberpunk Bride" }];
      },
      namesOf,
    );
    expect(queries).toEqual(["cyberpunk edge runners", "cyberpunk"]);
    expect(results).toEqual([{ title: "Cyberpunk: Edgerunners" }]);
  });

  test("a single-word miss stays a miss — no wider retry exists", async () => {
    const queries: string[] = [];
    const results = await searchWithPhraseFallback(
      "zzznothing",
      async (q) => {
        queries.push(q);
        return [];
      },
      namesOf,
    );
    expect(results).toEqual([]);
    expect(queries).toEqual(["zzznothing"]);
  });
});
