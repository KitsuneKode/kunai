import { describe, expect, test } from "bun:test";

import { createSearchIntentEngine } from "@/domain/search/SearchIntentEngine";

describe("SearchIntentEngine", () => {
  test("normalizes raw text filters against current shell mode", () => {
    const engine = createSearchIntentEngine();

    expect(
      engine.fromText("Dune year:2021 mode:movie sort:recent", {
        currentMode: "series",
      }),
    ).toMatchObject({
      intent: {
        query: "Dune",
        mode: "movie",
        filters: { year: 2021 },
        sort: "recent",
      },
      chips: ["mode movie", "year 2021", "sort recent"],
      warnings: [],
    });
  });

  test("keeps unknown filters non-blocking", () => {
    const engine = createSearchIntentEngine();

    const result = engine.fromText("Dune genre:sci-fi", { currentMode: "anime" });

    expect(result.intent.query).toBe("Dune");
    expect(result.intent.mode).toBe("anime");
    expect(result.warnings).toEqual(["Ignored unsupported filter genre:sci-fi"]);
  });
});
