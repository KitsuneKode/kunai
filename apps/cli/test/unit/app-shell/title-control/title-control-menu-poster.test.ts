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
