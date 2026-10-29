import { describe, expect, test } from "bun:test";

import { suggestCatalogTitles } from "@/services/search/suggest-titles";

describe("suggestCatalogTitles", () => {
  test("ignores queries shorter than minimum length", async () => {
    const outcome = await suggestCatalogTitles({
      query: "a",
      mode: "youtube",
      providerId: "youtube",
      searchRegistry: {
        get: () => undefined,
        // SAFETY: test stub for registry in youtube mode which does not invoke getDefault
        getDefault: () => ({}) as any,
        getForProvider: () => undefined,
      },
    });
    expect(outcome).toBeNull();
  });

  test("handles youtube mode query suggestions gracefully", async () => {
    const outcome = await suggestCatalogTitles({
      query: "test query",
      mode: "youtube",
      providerId: "youtube",
      searchRegistry: {
        get: () => undefined,
        // SAFETY: test stub for registry in youtube mode which does not invoke getDefault
        getDefault: () => ({}) as any,
        getForProvider: () => undefined,
      },
    });
    if (outcome) {
      expect(outcome.sourceId).toBe("youtube");
      expect(outcome.sourceName).toBe("YouTube Suggestions");
      for (const res of outcome.results) {
        expect(res.commitQuery).toBeDefined();
        expect(res.resolvedLane).toBe("youtube");
      }
    }
  });
});
