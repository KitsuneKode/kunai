import { expect, test } from "bun:test";

import { buildLoadingFooterActions } from "@/app-shell/loading-shell-model";
import type { LoadingShellState } from "@/app-shell/types";

function playingSeriesFixture(overrides: Partial<LoadingShellState> = {}): LoadingShellState {
  return {
    title: "Study Group",
    operation: "playing",
    isSeriesPlayback: true,
    hasNextEpisode: true,
    hasPreviousEpisode: true,
    footerMode: "detailed",
    ...overrides,
  };
}

test("playing footer includes next/prev/source when series playback", () => {
  const actions = buildLoadingFooterActions(playingSeriesFixture());
  const keys = actions.map((action) => action.key);
  expect(keys).toContain("n");
  expect(keys).toContain("p");
  expect(keys).toContain("o");
  expect(keys).toContain("/");
  expect(keys).toContain("q");
  // With next+prev present, series e/a are overflow — kept out of the capped footer.
  expect(keys).not.toContain("e");
  expect(keys).not.toContain("a");
});

test("playing footer keeps episode/autoplay when next/prev are unavailable", () => {
  const actions = buildLoadingFooterActions(
    playingSeriesFixture({
      hasNextEpisode: false,
      hasPreviousEpisode: false,
    }),
  );
  const keys = actions.map((action) => action.key);
  expect(keys).toContain("o");
  expect(keys).toContain("e");
  expect(keys).toContain("a");
  expect(keys).toContain("q");
});

test("playing footer stays dense and omits mpv overflow chords", () => {
  const actions = buildLoadingFooterActions(playingSeriesFixture());
  const keys = actions.map((action) => action.key.toLowerCase());
  // Quality / refresh / autoskip live in ? help and / commands, not the persistent footer.
  expect(keys).not.toContain("k");
  expect(keys).not.toContain("u");
  expect(keys).not.toContain("x");
  expect(keys.some((key) => key.includes("ctrl"))).toBe(false);
});
