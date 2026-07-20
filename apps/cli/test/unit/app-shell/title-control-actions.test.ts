import { expect, test } from "bun:test";

import { buildTitleControlActions } from "@/app-shell/title-control/title-control-actions";

test("title menu offers forget preference when a title is focused", () => {
  const actions = buildTitleControlActions({
    surface: "browse",
    hasTitle: true,
    titleName: "Demo",
    titleType: "series",
    hasTitleProviderPreference: true,
  });
  expect(actions.some((action) => action.id === "forget-title-provider-preference")).toBe(true);
});

test("title menu hides forget preference without a saved pin", () => {
  const actions = buildTitleControlActions({
    surface: "browse",
    hasTitle: true,
    titleName: "Demo",
    titleType: "series",
    hasTitleProviderPreference: false,
  });
  const forget = actions.find((action) => action.id === "forget-title-provider-preference");
  expect(forget?.enabled).toBe(false);
});
