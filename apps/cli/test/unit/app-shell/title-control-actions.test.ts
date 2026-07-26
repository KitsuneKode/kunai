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

// The loading surface is an allow-list. Omitting episode navigation filtered
// those actions out before `when()` ever ran, so opening the menu mid-resolve
// for a series showed only recovery actions -- no way to change episode.
test("loading offers episode navigation, not just recovery actions", () => {
  const actions = buildTitleControlActions({
    surface: "loading",
    hasTitle: true,
    titleName: "Ozark",
    titleType: "series",
    isLoading: true,
    hasNextEpisode: true,
    hasPreviousEpisode: true,
  });
  const byId = (id: string) => actions.find((action) => action.id === id);

  expect(byId("pick-episode")?.enabled).toBe(true);
  expect(byId("next")?.enabled).toBe(true);
  expect(byId("previous")?.enabled).toBe(true);
  // The recovery actions that were already there must survive.
  expect(byId("cancel")).toBeDefined();
  expect(byId("source")).toBeDefined();
});

test("episode rows name their target instead of reading as bare verbs", () => {
  const actions = buildTitleControlActions({
    surface: "post-play",
    hasTitle: true,
    titleName: "Ozark",
    titleType: "series",
    canResume: true,
    hasNextEpisode: true,
    currentSeason: 1,
    currentEpisodeNumber: 1,
    currentEpisodeName: "Sugarwood",
    resumeAtLabel: "0:37",
    nextEpisodeLabel: "S1E2",
    nextEpisodeName: "Blue Cat",
  });

  const resume = actions.find((action) => action.id === "resume");
  expect(resume?.label).toBe("Resume S1E1");
  expect(resume?.detail).toBe("Continue from 0:37 · Sugarwood");

  const next = actions.find((action) => action.id === "next");
  expect(next?.label).toBe("Next episode  S1E2");
  expect(next?.detail).toBe("Advance to the next released episode · Blue Cat");
});

test("anime drops the season coordinate users do not think in", () => {
  const actions = buildTitleControlActions({
    surface: "post-play",
    hasTitle: true,
    titleType: "series",
    isAnime: true,
    canResume: true,
    currentSeason: 1,
    currentEpisodeNumber: 13,
    resumeAtLabel: "4:02",
  });

  expect(actions.find((action) => action.id === "resume")?.label).toBe("Resume E13");
  expect(actions.find((action) => action.id === "pick-episode")?.label).toBe("Pick episode…");
});
