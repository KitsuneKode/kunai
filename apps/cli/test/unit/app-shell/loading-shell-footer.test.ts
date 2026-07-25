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

test("playing footer advertises autoskip, the surface where skipping happens", () => {
  // Autoskip was offered only by the bootstrap footer, so the key was invisible
  // during playback itself — the one moment it matters.
  const actions = buildLoadingFooterActions({
    title: "Bad Guys",
    operation: "playing",
    isSeriesPlayback: true,
    autoplayPaused: false,
    autoskipPaused: false,
  });

  expect(actions.find((action) => action.action === "toggle-autoskip")).toMatchObject({
    key: "u",
    label: "pause autoskip",
  });
});

test("playing footer keeps autoskip on a movie but drops autoplay", () => {
  // Autoplay means "start the next episode", so a movie has nothing for it to
  // do. Autoskip still applies, and a movie previously got neither.
  const actions = buildLoadingFooterActions({
    title: "Fight Club",
    operation: "playing",
    isSeriesPlayback: false,
    autoplayPaused: false,
    autoskipPaused: true,
  });

  const ids = actions.map((action) => action.action);
  expect(ids).toContain("toggle-autoskip");
  expect(ids).not.toContain("toggle-autoplay");
  expect(ids).not.toContain("pick-episode");
  expect(actions.find((action) => action.action === "toggle-autoskip")?.label).toBe(
    "resume autoskip",
  );
});
