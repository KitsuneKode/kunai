import { expect, test } from "bun:test";

import { loadLocalSuggestionCorpus } from "@/app/search/search-suggestions";
import type { HistoryProgress } from "@kunai/storage";

function history(mediaKind: HistoryProgress["mediaKind"], title: string): HistoryProgress {
  return {
    key: title,
    titleId: `${mediaKind}:${title}`,
    mediaKind,
    providerId: mediaKind === "anime" ? "hianime" : mediaKind === "video" ? "youtube" : "vidlink",
    title,
    positionSeconds: 10,
    completed: false,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
}

test("local suggestion rows belong to the active mode across media kinds", () => {
  const source = {
    historyRepository: {
      listLatestByTitle: () => [
        history("anime", "Frieren"),
        history("movie", "Dune"),
        history("video", "Lofi"),
      ],
    },
    followedTitleRepository: { listByPreference: () => [] },
    listService: { getFavorites: () => [], getWatchlist: () => [], getListItems: () => [] },
    listRepository: { getLists: () => [] },
    playlistsRepository: { list: () => [], listItems: () => [] },
  } satisfies Parameters<typeof loadLocalSuggestionCorpus>[0];
  expect(loadLocalSuggestionCorpus(source, "anime").map((row) => row.title)).toEqual(["Frieren"]);
  expect(loadLocalSuggestionCorpus(source, "series").map((row) => row.title)).toEqual(["Dune"]);
  expect(loadLocalSuggestionCorpus(source, "youtube").map((row) => row.title)).toEqual(["Lofi"]);
});
