import { afterAll, expect, test } from "bun:test";

import { ListRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

function repo(name: string): ListRepository {
  return new ListRepository(stores.store(name));
}

const dune = {
  titleId: "tmdb:693134",
  mediaKind: "movie",
  title: "Dune: Part Two",
} as const;

/**
 * Membership is a set. `addItem` ran a bare INSERT against a table with no
 * uniqueness on `(list_id, title_id)`, so pressing "add to watchlist" twice
 * stored the title twice — invisible to `isInList` (LIMIT 1) and to removal
 * (DELETE without a limit), and visible only as a list that had grown.
 */
test("adding the same title twice keeps exactly one row", () => {
  const lists = repo("lists-dedupe");

  lists.addItem({ ...dune, listId: "watchlist" });
  lists.addItem({ ...dune, listId: "watchlist" });

  expect(lists.getItems("watchlist")).toHaveLength(1);
});

test("re-adding refreshes descriptive fields without reordering the list", () => {
  const lists = repo("lists-refresh");

  const first = lists.addItem({ ...dune, listId: "watchlist", title: "Dune" });
  lists.addItem({
    titleId: "tmdb:1396",
    mediaKind: "series",
    title: "Breaking Bad",
    listId: "watchlist",
  });
  const second = lists.addItem({ ...dune, listId: "watchlist", title: "Dune: Part Two" });

  // Same row, updated title, original position and timestamp preserved: re-adding
  // something is not re-discovering it.
  expect(second.id).toBe(first.id);
  expect(second.title).toBe("Dune: Part Two");
  expect(second.addedAt).toBe(first.addedAt);
  expect(lists.getItems("watchlist").map((item) => item.titleId)).toEqual([
    "tmdb:693134",
    "tmdb:1396",
  ]);
});

/** The same title in two different lists is not a duplicate. */
test("the same title may sit in both the watchlist and favorites", () => {
  const lists = repo("lists-scope");

  lists.addItem({ ...dune, listId: "watchlist" });
  lists.addItem({ ...dune, listId: "favorites" });

  expect(lists.isInList("watchlist", dune.titleId)).toBe(true);
  expect(lists.isInList("favorites", dune.titleId)).toBe(true);
});

test("toggling twice returns to empty", () => {
  const lists = repo("lists-toggle");

  expect(lists.toggleItem("favorites", { ...dune, listId: "favorites" })).toBe("added");
  expect(lists.toggleItem("favorites", { ...dune, listId: "favorites" })).toBe("removed");
  expect(lists.getItems("favorites")).toHaveLength(0);
});
