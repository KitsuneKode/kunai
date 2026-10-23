import { expect, test } from "bun:test";

import { buildLoadingFooterActions } from "@/app-shell/loading-shell-model";

test("loading footer exposes source picker when stream candidates exist", () => {
  const actions = buildLoadingFooterActions({
    title: "Bad Guys",
    operation: "loading",
    hasStreamCandidates: true,
    fallbackAvailable: true,
    fallbackProviderName: "AllManga",
  });

  expect(actions.map((action) => action.action)).toContain("source");
  expect(actions.find((action) => action.action === "source")?.key).toBe("o");
});

test("loading footer advertises cancel while bootstrap is cancellable", () => {
  const actions = buildLoadingFooterActions({
    title: "Bad Guys",
    operation: "loading",
    cancellable: true,
  });

  expect(actions.find((action) => action.action === "quit")).toMatchObject({
    key: "q",
    label: "cancel → results",
  });
});

test("loading footer omits cancel when bootstrap is not cancellable", () => {
  const actions = buildLoadingFooterActions({
    title: "Bad Guys",
    operation: "loading",
    cancellable: false,
  });

  expect(actions.find((action) => action.action === "quit")).toBeUndefined();
});

test("bootstrap footer stays focused on cancellation and recovery", () => {
  const actions = buildLoadingFooterActions({
    title: "Bad Guys",
    operation: "loading",
    cancellable: true,
    isSeriesPlayback: true,
    fallbackAvailable: true,
    hasStreamCandidates: true,
  });
  expect(actions.map((action) => action.action)).toEqual([
    "quit",
    "fallback",
    "source",
    "command-mode",
  ]);
});

test("playing footer prioritizes Tracks and quality with one command entry", () => {
  const actions = buildLoadingFooterActions({
    title: "Bad Guys",
    operation: "playing",
    isSeriesPlayback: true,
    hasNextEpisode: true,
    autoplayPaused: false,
    autoskipPaused: false,
  });
  expect(actions.find((action) => action.action === "source")).toMatchObject({
    key: "o",
    label: "tracks",
    primary: true,
  });
  expect(actions.find((action) => action.action === "quality")?.key).toBe("k");
  expect(actions.find((action) => action.action === "command-mode")).toMatchObject({
    key: "/",
    label: "commands",
  });
  expect(actions.filter((action) => action.action === "command-mode")).toHaveLength(1);
  expect(actions.map((action) => action.action)).toContain("pick-episode");
  expect(actions.map((action) => action.action)).toContain("next");
  expect(actions.length).toBeLessThanOrEqual(6);
});

test("movie footer offers only applicable playback navigation", () => {
  const actions = buildLoadingFooterActions({
    title: "Fight Club",
    operation: "playing",
    isSeriesPlayback: false,
  });
  expect(actions.map((action) => action.action)).toEqual([
    "source",
    "quality",
    "quit",
    "command-mode",
  ]);
});
