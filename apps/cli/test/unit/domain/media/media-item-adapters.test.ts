import { expect, test } from "bun:test";

import {
  mediaItemFromHistoryEntry,
  mediaItemFromSearchResult,
} from "@/domain/media/media-item-adapters";

test("history entries convert to media identity without provider URLs", () => {
  const item = mediaItemFromHistoryEntry("tmdb:1", {
    key: "k",
    titleId: "x",
    title: "Example",
    mediaKind: "series",
    season: 1,
    episode: 2,
    positionSeconds: 60,
    durationSeconds: 1200,
    completed: false,
    providerId: "vidking",
    updatedAt: "2026-05-17T00:00:00.000Z",
    createdAt: "2026-05-17T00:00:00.000Z",
  });

  expect(item).toMatchObject({
    mediaKind: "series",
    titleId: "tmdb:1",
    title: "Example",
    season: 1,
    episode: 2,
  });
  expect(JSON.stringify(item)).not.toContain("http");
});

test("search results convert to media identity for shared action policy", () => {
  expect(
    mediaItemFromSearchResult({
      id: "tmdb:2",
      title: "Movie",
      type: "movie",
      year: "2026",
      overview: "",
      posterPath: null,
    }),
  ).toMatchObject({
    mediaKind: "movie",
    titleId: "tmdb:2",
    title: "Movie",
  });
});
