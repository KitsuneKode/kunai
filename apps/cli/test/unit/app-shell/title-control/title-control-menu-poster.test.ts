import { expect, test } from "bun:test";

import type { TitleControlContext } from "@/app-shell/title-control/title-control-actions";
import {
  buildTitleControlMenuModel,
  titleControlMenuOptions,
} from "@/app-shell/title-control/title-control-menu";

const baseCtx: TitleControlContext = {
  surface: "loading",
  hasTitle: true,
  titleName: "Ozark",
  titleType: "series",
  isLoading: true,
  hasNextEpisode: true,
};

// The preview pane reads the poster off the *selected* row, so a row without it
// blanks the pane. That is why the menu rendered as text-only where the
// session-flow picker showed a poster.
test("every row carries the poster so the preview never blinks out", () => {
  const model = buildTitleControlMenuModel({
    ...baseCtx,
    posterUrl: "https://image.tmdb.org/t/p/w342/ozark.jpg",
  });
  const options = titleControlMenuOptions(model, new Set());

  expect(options.length).toBeGreaterThan(0);
  for (const option of options) {
    expect(option.previewImageUrl).toBe("https://image.tmdb.org/t/p/w342/ozark.jpg");
  }
});

test("a title with no poster leaves the field unset rather than empty-stringing it", () => {
  const model = buildTitleControlMenuModel(baseCtx);
  const options = titleControlMenuOptions(model, new Set());

  expect(model.posterUrl).toBeUndefined();
  for (const option of options) {
    expect(option.previewImageUrl).toBeUndefined();
  }
});

// `ShellOption` carried neither flag, and `.map()` produces a non-fresh type so
// TypeScript never flagged the extra properties -- both were dropped silently
// between the menu and the renderer. Rows that discard data looked exactly like
// rows that play something, and unavailable rows looked available until picked.
test("cache purges are marked destructive so the renderer can warn on them", () => {
  const model = buildTitleControlMenuModel(baseCtx);
  const options = titleControlMenuOptions(model, new Set(["providers-data", "this-title"]));

  const destructive = options
    .filter((option) => option.destructive)
    .map((option) => String(option.value))
    .sort();
  expect(destructive).toEqual([
    "purge-episode-cache",
    "purge-title-cache",
    "reset-provider-health",
  ]);

  // And a row that merely plays something must not inherit the tone.
  expect(options.find((option) => option.value === "pick-episode")?.destructive).toBeUndefined();
});
