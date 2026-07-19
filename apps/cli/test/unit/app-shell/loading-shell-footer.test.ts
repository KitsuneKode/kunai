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
    label: "cancel",
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

test("loading footer exposes autoplay controls for series playback even at episode boundaries", () => {
  const actions = buildLoadingFooterActions({
    title: "Bad Guys",
    operation: "loading",
    isSeriesPlayback: true,
    autoplayPaused: true,
    autoskipPaused: false,
  });

  expect(actions.map((action) => action.action)).toContain("toggle-autoplay");
  expect(actions.map((action) => action.action)).toContain("toggle-autoskip");
  expect(actions.map((action) => action.action)).toContain("stop-after-current");
  expect(actions.find((action) => action.action === "toggle-autoplay")?.label).toBe(
    "resume autoplay",
  );
});

test("playing footer advertises command mode instead of space pause", () => {
  const actions = buildLoadingFooterActions({
    title: "Bad Guys",
    operation: "playing",
    isSeriesPlayback: true,
    autoplayPaused: false,
    autoskipPaused: false,
  });

  expect(actions.find((action) => action.action === "command-mode")).toMatchObject({
    key: "/",
    label: "commands",
    primary: true,
  });
  expect(actions.find((action) => action.key === "space")).toBeUndefined();
  expect(actions.map((action) => action.action)).toContain("toggle-autoplay");
});
