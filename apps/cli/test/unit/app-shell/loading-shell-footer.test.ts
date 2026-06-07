import { expect, test } from "bun:test";

import { buildLoadingFooterActions } from "@/app-shell/loading-shell";

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

  expect(actions[0]).toMatchObject({
    key: "/",
    label: "commands",
    action: "command-mode",
    primary: true,
  });
  expect(actions.find((action) => action.key === "space")).toBeUndefined();
  expect(actions.map((action) => action.action)).toContain("toggle-autoplay");
});
