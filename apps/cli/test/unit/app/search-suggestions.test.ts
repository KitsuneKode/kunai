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

test("other modes cannot exhaust watched, saved, followed or playlist item quotas", () => {
  const videos = Array.from({ length: 60 }, (_, index) => history("video", `Video ${index}`));
  const stored = (title: string, mediaKind = "anime") => ({
    titleId: `${mediaKind}:${title}`,
    title,
    mediaKind,
    addedAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  });
  const storedVideos = videos.map((row) => stored(row.title, "video"));
  const source = {
    historyRepository: { listLatestByTitle: () => [...videos, history("anime", "Watched anime")] },
    followedTitleRepository: {
      listByPreference: () => [...storedVideos, stored("Followed anime")],
    },
    listService: {
      getFavorites: () => [...storedVideos, stored("Favourite anime")],
      getWatchlist: () => [...storedVideos, stored("Saved anime")],
      getListItems: () => [...storedVideos, stored("List anime")],
    },
    listRepository: { getLists: () => [{ id: "custom", name: "Custom" }] },
    playlistsRepository: {
      list: () => [{ id: "playlist", name: "Playlist" }],
      listItems: () => [
        ...storedVideos,
        { ...stored("Playlist anime"), id: "item", playlistId: "playlist" },
      ],
    },
  };
  // SAFETY: partial read-only repositories implement every reader this function consumes.
  const corpusSource = source as never;
  const rows = loadLocalSuggestionCorpus(corpusSource, "anime");
  expect(rows.map((row) => row.title)).toEqual([
    "Watched anime",
    "Favourite anime",
    "Saved anime",
    "Followed anime",
    "List anime",
    "Playlist anime",
  ]);
  expect(
    loadLocalSuggestionCorpus(corpusSource, "youtube").every(
      (row) => row.value?.resolvedLane === "youtube",
    ),
  ).toBe(true);
  expect(loadLocalSuggestionCorpus(corpusSource, "series")).toEqual([]);
});
