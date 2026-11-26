import { expect, test } from "bun:test";

import { consumeShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import { adoptHistoryEntry } from "@/app/search/search-selection-routing";
import type { Container } from "@/container";

test("a /watch link from search keeps its start time, title and episode", () => {
  const dispatched: { type: string }[] = [];
  // SAFETY: the helper only dispatches through the state manager.
  const container: Pick<Container, "stateManager"> = {
    stateManager: { dispatch: (action: { type: string }) => dispatched.push(action) },
  } as never;
  const title = { id: "tmdb:1", type: "series", name: "Show" } as const;

  const adopted = adoptHistoryEntry(container, {
    title,
    episode: { season: 2, episode: 7 },
    startSeconds: 42,
  });

  expect(adopted).toBe(title);
  expect(dispatched.map((action) => action.type)).toEqual(["SELECT_TITLE", "SELECT_EPISODE"]);
  expect(consumeShareBootstrapStartSeconds()).toBe(42);
});

test("an entry without a start time leaves none behind", () => {
  // SAFETY: the helper only dispatches through the state manager.
  const container: Pick<Container, "stateManager"> = {
    stateManager: { dispatch: () => undefined },
  } as never;
  adoptHistoryEntry(container, { title: { id: "tmdb:2", type: "movie", name: "Film" } });
  expect(consumeShareBootstrapStartSeconds()).toBeUndefined();
});
