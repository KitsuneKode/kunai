import { expect, test } from "bun:test";

import {
  buildPostPlayView,
  resolvePostPlayMenuAction,
  resolvePostPlayUnhandledInput,
} from "@/app-shell/post-play-view";

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

test("up-next reflects paused autoplay state", () => {
  const view = buildPostPlayView({
    ...base,
    nextEpisodeLabel: "S01 E07 — Next One",
    autoplayPaused: true,
  });

  expect(view.upNext?.meta).toContain("autoplay paused");
  expect(view.actions[0]?.detail).toContain("autoplay paused");
});

test("mid-series post-play surfaces session controls", () => {
  const view = buildPostPlayView({
    ...base,
    autoskipPaused: true,
    stopAfterCurrent: true,
  });

  const sessionRow = view.actions.find((action) => action.id === "session-controls");
  expect(sessionRow?.shortcut).toBe("a · u · x");
  expect(sessionRow?.detail).toContain("autoskip paused");
  expect(sessionRow?.detail).toContain("chain stops after next play");
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

test("series-complete with a queued item puts queue-next first and resolves Enter to that id", () => {
  const view = buildPostPlayView({
    ...base,
    postPlayState: { kind: "series-complete" },
    nextEpisodeLabel: undefined,
    queueNextLabel: "Queued Anime · S01E13",
    queueNextEntryId: "qe-exact-13",
  });
  expect(view.actions[0]?.id).toBe("queue-next");
  expect(view.actions[0]?.primary).toBe(true);
  expect(view.actions[0]?.queueEntryId).toBe("qe-exact-13");
  expect(resolvePostPlayMenuAction(view.actions[0]!)).toEqual({
    type: "play-queue-entry",
    queueEntryId: "qe-exact-13",
  });
  expect(
    resolvePostPlayUnhandledInput(
      "n",
      {},
      {
        postPlayStateKind: "series-complete",
        selectedActionAvailable: true,
        recommendationCount: 0,
        queueNextEntryId: "qe-exact-13",
      },
    ),
  ).toEqual({
    type: "shell-result",
    result: { type: "play-queue-entry", queueEntryId: "qe-exact-13" },
  });
});

test("caught-up with a queued item puts queue-next first and resolves n to that id", () => {
  const view = buildPostPlayView({
    ...base,
    postPlayState: { kind: "caught-up", nextAirDate: "Thu 23:00" },
    nextEpisodeLabel: undefined,
    queueNextLabel: "Next Title",
    queueNextEntryId: "qe-caught-up-1",
  });
  expect(view.actions[0]?.id).toBe("queue-next");
  expect(view.actions[0]?.primary).toBe(true);
  expect(resolvePostPlayMenuAction(view.actions[0]!)).toEqual({
    type: "play-queue-entry",
    queueEntryId: "qe-caught-up-1",
  });
  expect(
    resolvePostPlayUnhandledInput(
      "n",
      {},
      {
        postPlayStateKind: "caught-up",
        selectedActionAvailable: true,
        recommendationCount: 0,
        queueNextEntryId: "qe-caught-up-1",
      },
    ),
  ).toEqual({
    type: "shell-result",
    result: { type: "play-queue-entry", queueEntryId: "qe-caught-up-1" },
  });
});
