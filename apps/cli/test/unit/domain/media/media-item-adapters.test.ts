import { expect, test } from "bun:test";

import {
  mediaItemFromHistoryEntry,
  mediaItemFromSearchResult,
  titleInfoFromMediaItemIdentity,
} from "@/domain/media/media-item-adapters";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { MediaKind } from "@kunai/types";

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

test("an anime-film history row keeps anime identity and movie structure", () => {
  const item = mediaItemFromHistoryEntry("anilist:181053", {
    key: "k",
    titleId: "anilist:181053",
    title: "Infinity Castle",
    mediaKind: "anime",
    positionSeconds: 600,
    durationSeconds: 7200,
    completed: false,
    providerId: "allanime",
    updatedAt: "2026-08-16T00:00:00.000Z",
    createdAt: "2026-08-16T00:00:00.000Z",
  });

  expect(item).toMatchObject({ mediaKind: "anime", contentType: "movie" });
  expect(item.episode).toBeUndefined();
  expect(titleInfoFromMediaItemIdentity(item)).toMatchObject({ type: "movie", isAnime: true });
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

/**
 * `TitleInfo.type` is a two-way shape used by provider/playback code; it is not
 * the content-kind authority. Video must not be silently reshaped into a series
 * and gain an episode it never had.
 */
test.each([
  ["movie", "movie"],
  ["video", "movie"],
  ["series", "series"],
  ["anime", "series"],
] as const)("titleInfo for a %s identity uses TitleInfo.type %s", (mediaKind, expected) => {
  expect(
    titleInfoFromMediaItemIdentity({
      mediaKind,
      titleId: "t1",
      title: "Example",
    }).type,
  ).toBe(expected);
});

test("MediaItemIdentity accepts every shared MediaKind", () => {
  const kinds: MediaKind[] = ["movie", "series", "anime", "video"];
  for (const mediaKind of kinds) {
    const item: MediaItemIdentity = { mediaKind, titleId: "t1", title: "Example" };
    expect(item.mediaKind).toBe(mediaKind);
  }
});
