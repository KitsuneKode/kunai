import { describe, expect, test } from "bun:test";

import {
  buildTitleControlActions,
  type TitleControlContext,
} from "@/app-shell/title-control/title-control-actions";

function actionIds(context: TitleControlContext): string[] {
  return buildTitleControlActions(context).map((action) => action.id);
}

describe("history title-control surface", () => {
  test("offers download when downloads are enabled", () => {
    const ids = actionIds({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      downloadsEnabled: true,
    });

    expect(ids).toContain("download");
  });

  test("offers resume, enabled when the row has a saved position", () => {
    const actions = buildTitleControlActions({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      hasSavedPosition: true,
      titleType: "series",
      downloadsEnabled: true,
    });

    expect(actions.find((action) => action.id === "resume")?.enabled).toBe(true);
  });

  test("offers marking watched, which older surfaces gated away from history", () => {
    const actions = buildTitleControlActions({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      downloadsEnabled: true,
    });

    expect(actions.find((action) => action.id === "mark-watched")?.enabled).toBe(true);
    expect(actions.find((action) => action.id === "mark-unwatched")?.enabled).toBe(true);
  });

  test("omits actions that would target the session instead of the row", () => {
    // The overlay executes the picked action against the highlighted row, so an
    // action it cannot target that way must not be offered at all.
    const ids = actionIds({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      downloadsEnabled: true,
    });

    expect(ids).not.toContain("switch-provider");
    expect(ids).not.toContain("purge-title-cache");
    // `play` shares the `resume` shell action and would arrive indistinguishable.
    expect(ids).not.toContain("play");
  });

  test("does not offer playback-only controls", () => {
    const ids = actionIds({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      downloadsEnabled: true,
    });

    // Nothing is playing when you are looking at history.
    expect(ids).not.toContain("stop");
    expect(ids).not.toContain("quality");
    expect(ids).not.toContain("cancel");
  });
});

describe("download follows the downloads capability", () => {
  test("hides download from history when downloads are disabled", () => {
    const ids = actionIds({
      surface: "history",
      hasTitle: true,
      hasHistory: true,
      downloadsEnabled: false,
    });

    expect(ids).not.toContain("download");
  });

  test("hides download from every other surface too", () => {
    // A disabled capability should not leave a dead entry on browse and
    // playing while history hides it.
    for (const surface of ["browse", "library", "playing"] as const) {
      const ids = actionIds({ surface, hasTitle: true, downloadsEnabled: false });
      expect(ids).not.toContain("download");
    }
  });

  test("an unspecified capability leaves download alone", () => {
    // Contexts built before this flag existed must not silently lose an action.
    const ids = actionIds({ surface: "library", hasTitle: true });
    expect(ids).toContain("download");
  });

  test("disabling downloads removes only download", () => {
    const enabled = actionIds({ surface: "library", hasTitle: true, downloadsEnabled: true });
    const disabled = actionIds({ surface: "library", hasTitle: true, downloadsEnabled: false });

    expect(enabled.filter((id) => id !== "download")).toEqual(disabled);
  });
});
