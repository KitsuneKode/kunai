import { expect, test } from "bun:test";

import { buildPostPlayView } from "@/app-shell/post-play-view";

const base = {
  title: "Test Title",
  episodeLabel: "S01 E06 — Challengers",
  postPlayState: { kind: "mid-series" as const },
};

test("up-next prefers the episode-chain next when present", () => {
  const view = buildPostPlayView({
    ...base,
    nextEpisodeLabel: "S01 E07 — Next One",
    queueNextLabel: "Some Queued Movie",
  });
  expect(view.upNext?.label).toContain("E07");
});

test("up-next falls back to the cross-title queue head when there is no next episode", () => {
  const view = buildPostPlayView({
    ...base,
    postPlayState: { kind: "series-complete" },
    nextEpisodeLabel: undefined,
    queueNextLabel: "Some Queued Movie",
  });
  expect(view.upNext?.label).toContain("Some Queued Movie");
  expect(view.upNext?.meta.toLowerCase()).toContain("queue");
});

test("up-next is absent when neither a next episode nor a queue head exists", () => {
  const view = buildPostPlayView({
    ...base,
    postPlayState: { kind: "series-complete" },
    nextEpisodeLabel: undefined,
    queueNextLabel: undefined,
  });
  expect(view.upNext).toBeUndefined();
});
