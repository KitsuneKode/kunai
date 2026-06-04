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
