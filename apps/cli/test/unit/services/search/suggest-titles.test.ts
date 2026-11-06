import { beforeEach, afterEach, expect, spyOn, test } from "bun:test";

import { suggestCatalogTitles } from "@/services/search/suggest-titles";
import { configureYoutubeProvider } from "@kunai/providers/youtube";

function mockFetch() {
  return spyOn(globalThis, "fetch");
}
let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
});
afterEach(() => {
  fetchMock.mockRestore();
  configureYoutubeProvider({});
});
const registry = {
  get: () => undefined,
  getDefault: () => {
    throw new Error("YouTube suggestions must not use TMDB");
  },
  getForProvider: () => undefined,
};

test("ignores short or aborted queries without a network request", async () => {
  expect(
    await suggestCatalogTitles({
      query: "a",
      mode: "youtube",
      providerId: "youtube",
      searchRegistry: registry,
    }),
  ).toBeNull();
  expect(
    await suggestCatalogTitles({
      query: "lofi",
      mode: "youtube",
      providerId: "youtube",
      searchRegistry: registry,
      signal: AbortSignal.abort(),
    }),
  ).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("YouTube suggestions preserve query identity, limit and configured instance", async () => {
  configureYoutubeProvider({ invidiousInstanceUrl: "https://private.example.test" });
  fetchMock.mockResolvedValue(Response.json({ suggestions: ["lofi radio", "lofi piano"] }));
  const outcome = await suggestCatalogTitles({
    query: "lofi",
    mode: "youtube",
    providerId: "youtube",
    searchRegistry: registry,
    limit: 1,
  });
  expect(outcome?.results).toHaveLength(1);
  expect(outcome?.sourceId).toBe("youtube");
  expect(outcome?.results[0]).toMatchObject({
    commitQuery: "lofi radio",
    resolvedLane: "youtube",
    resultKind: "video",
  });
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
    "https://private.example.test/api/v1/search/suggestions?q=lofi",
  );
});

test("series suggestions do not make YouTube requests", async () => {
  expect(
    await suggestCatalogTitles({
      query: "lofi",
      mode: "series",
      providerId: "vidlink",
      searchRegistry: registry,
    }),
  ).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
