// Same contract as history: a caller that knows less than the stored row must
// never subtract from it. Lists and follows both replaced `title` (and lists,
// `external_ids_json`) outright, so re-adding a title launched by id alone would
// overwrite the real name and erase the ids that address its tracker entry.

import { afterEach, expect, test } from "bun:test";

import { FollowedTitleRepository, ListRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

function lists(): ListRepository {
  return new ListRepository(stores.store("list-metadata-preservation", "data"));
}

function follows(): FollowedTitleRepository {
  return new FollowedTitleRepository(stores.store("follow-metadata-preservation", "data"));
}

test("a placeholder never overwrites a stored list item's real title", () => {
  const repo = lists();
  const list = repo.createList({ name: "Watchlist", kind: "watchlist" });
  repo.addItem({
    listId: list.id,
    titleId: "438631",
    mediaKind: "movie",
    title: "Dune",
    externalIds: { tmdbId: "438631", imdbId: "tt1160419" },
  });

  repo.addItem({
    listId: list.id,
    titleId: "438631",
    mediaKind: "movie",
    title: "TMDB 438631",
  });

  const item = repo.getItems(list.id)[0];
  expect(item?.title).toBe("Dune");
  expect(item?.externalIds).toEqual({ tmdbId: "438631", imdbId: "tt1160419" });
});

test("a real title still replaces a stored list placeholder — heal forward", () => {
  const repo = lists();
  const list = repo.createList({ name: "Watchlist", kind: "watchlist" });
  repo.addItem({ listId: list.id, titleId: "438631", mediaKind: "movie", title: "TMDB 438631" });

  repo.addItem({ listId: list.id, titleId: "438631", mediaKind: "movie", title: "Dune" });

  expect(repo.getItems(list.id)[0]?.title).toBe("Dune");
});

test("an ordinary list rename still applies", () => {
  const repo = lists();
  const list = repo.createList({ name: "Watchlist", kind: "watchlist" });
  repo.addItem({ listId: list.id, titleId: "438631", mediaKind: "movie", title: "Dune" });

  repo.addItem({ listId: list.id, titleId: "438631", mediaKind: "movie", title: "Dune: Part One" });

  expect(repo.getItems(list.id)[0]?.title).toBe("Dune: Part One");
});

test("re-adding without external ids never erases a list item's stored ids", () => {
  const repo = lists();
  const list = repo.createList({ name: "Watchlist", kind: "watchlist" });
  repo.addItem({
    listId: list.id,
    titleId: "438631",
    mediaKind: "movie",
    title: "Dune",
    externalIds: { tmdbId: "438631" },
  });

  repo.addItem({ listId: list.id, titleId: "438631", mediaKind: "movie", title: "Dune" });

  expect(repo.getItems(list.id)[0]?.externalIds).toEqual({ tmdbId: "438631" });
});

test("a placeholder never overwrites a followed title's real name", () => {
  const repo = follows();
  repo.upsert({
    titleId: "1396",
    mediaKind: "series",
    title: "Breaking Bad",
    preference: "following",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });

  repo.upsert({
    titleId: "1396",
    mediaKind: "series",
    title: "TMDB 1396",
    preference: "muted",
    updatedAt: "2026-08-02T00:00:00.000Z",
  });

  const row = repo.get("1396");
  expect(row?.title).toBe("Breaking Bad");
  // The preference itself is what the caller meant to change, and still applies.
  expect(row?.preference).toBe("muted");
});

test("a real title still replaces a stored followed placeholder", () => {
  const repo = follows();
  repo.upsert({
    titleId: "1396",
    mediaKind: "series",
    title: "TMDB 1396",
    preference: "following",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });

  repo.upsert({
    titleId: "1396",
    mediaKind: "series",
    title: "Breaking Bad",
    preference: "following",
    updatedAt: "2026-08-02T00:00:00.000Z",
  });

  expect(repo.get("1396")?.title).toBe("Breaking Bad");
});
