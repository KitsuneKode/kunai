import { expect, test } from "bun:test";

import { searchAnimeViaSiblingProvider } from "@/services/search/SearchRoutingService";

test("a real empty anime search stops the sibling walk and a throw does not", async () => {
  const calls: string[] = [];
  const context = {
    signal: undefined,
    animeLanguageProfile: { audio: "sub", subtitle: "en" },
    providerRegistry: {
      getAll: () => [
        {
          metadata: { id: "first", name: "First", isAnimeProvider: true },
          search: async () => {
            calls.push("first");
            return [];
          },
        },
        {
          metadata: { id: "second", name: "Second", isAnimeProvider: true },
          search: async () => {
            calls.push("second");
            return [{ id: "kept", name: "Kept" }];
          },
        },
      ],
    },
  };

  const empty = await searchAnimeViaSiblingProvider("query", "lane", context as never);
  expect(calls).toEqual(["first"]);
  expect(empty?.results).toEqual([]);

  calls.length = 0;
  context.providerRegistry = {
    getAll: () => [
      {
        metadata: { id: "first", name: "First", isAnimeProvider: true },
        search: async () => {
          calls.push("first");
          throw new Error("down");
        },
      },
      {
        metadata: { id: "second", name: "Second", isAnimeProvider: true },
        search: async () => {
          calls.push("second");
          return [{ id: "kept", name: "Kept" }];
        },
      },
    ],
  };
  const recovered = await searchAnimeViaSiblingProvider("query", "lane", context as never);
  expect(calls).toEqual(["first", "second"]);
  expect(recovered?.providerId).toBe("second");
});
