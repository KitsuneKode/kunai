import { describe, expect, test } from "bun:test";

import {
  resolvePlaybackEpisodeEntry,
  shouldAutoLaunchPlayback,
  type PlaybackEpisodeEntryContext,
} from "@/app-shell/title-control/smart-auto-launch";
import {
  buildTitleControlActions,
  type TitleControlContext,
} from "@/app-shell/title-control/title-control-actions";
import {
  applyTitleControlMenuExpand,
  buildTitleControlMenuModel,
  isTitleControlMenuExpandToken,
  titleControlMenuOptions,
} from "@/app-shell/title-control/title-control-menu";

function baseCtx(overrides: Partial<TitleControlContext> = {}): TitleControlContext {
  return {
    surface: "browse",
    hasTitle: true,
    titleType: "series",
    isAnime: false,
    hasHistory: false,
    hasSavedPosition: false,
    historyFinished: false,
    hasNextEpisode: false,
    hasPreviousEpisode: false,
    hasNextSeason: false,
    seriesComplete: false,
    isFirstWatch: true,
    providerCount: 2,
    failedProvider: false,
    isLoading: false,
    isPlaying: false,
    hasStreamCandidates: false,
    hasResolvedStream: false,
    ...overrides,
  };
}

describe("buildTitleControlActions", () => {
  test("browse surface exposes play and hides stop", () => {
    const actions = buildTitleControlActions(baseCtx({ surface: "browse" }));
    expect(actions.some((action) => action.id === "play" && action.enabled)).toBe(true);
    expect(actions.some((action) => action.id === "stop")).toBe(false);
  });

  test("playing surface enables next when available and disables resume", () => {
    const actions = buildTitleControlActions(
      baseCtx({
        surface: "playing",
        isPlaying: true,
        hasNextEpisode: true,
        hasSavedPosition: true,
      }),
    );
    const next = actions.find((action) => action.id === "next");
    expect(next?.enabled).toBe(true);
    expect(actions.some((action) => action.id === "resume")).toBe(false);
  });

  test("lazy resolve is disabled on browse but enabled while loading", () => {
    const browse = buildTitleControlActions(baseCtx({ surface: "browse" }));
    const loading = buildTitleControlActions(baseCtx({ surface: "loading", isLoading: true }));
    expect(browse.find((action) => action.id === "lazy-resolve-source")?.enabled).toBe(false);
    expect(loading.find((action) => action.id === "lazy-resolve-source")?.enabled).toBe(true);
  });

  test("switch provider self-disables with one provider", () => {
    const actions = buildTitleControlActions(baseCtx({ providerCount: 1 }));
    const provider = actions.find((action) => action.id === "switch-provider");
    expect(provider?.enabled).toBe(false);
    expect(provider?.reason).toContain("one provider");
  });
});

describe("buildTitleControlMenuModel", () => {
  test("groups actions with primary disclosed and secondary collapsed", () => {
    const model = buildTitleControlMenuModel(
      baseCtx({
        surface: "playing",
        isPlaying: true,
        hasNextEpisode: true,
        hasResolvedStream: true,
        providerCount: 2,
      }),
    );
    const primary = model.groups.find((group) => group.id === "primary");
    const providers = model.groups.find((group) => group.id === "providers-data");
    expect(primary?.disclosed).toBe(true);
    expect(providers?.disclosed).toBe(false);

    const collapsed = titleControlMenuOptions(model, new Set());
    expect(collapsed.some((option) => option.label.startsWith("▸ Providers & data"))).toBe(true);
    expect(collapsed.some((option) => option.value === "next")).toBe(true);

    const expanded = titleControlMenuOptions(
      model,
      applyTitleControlMenuExpand("__expand-providers-data__", new Set()),
    );
    expect(expanded.some((option) => option.value === "switch-provider")).toBe(true);
    expect(isTitleControlMenuExpandToken("__expand-providers-data__")).toBe(true);
  });
});

function playbackCtx(
  overrides: Partial<PlaybackEpisodeEntryContext> = {},
): PlaybackEpisodeEntryContext {
  return {
    titleId: "title-1",
    titleType: "series",
    isAnime: false,
    preselectedEpisode: { season: 1, episode: 3 },
    history: {
      positionSeconds: 600,
      durationSeconds: 1200,
      completed: false,
    },
    flags: {},
    ...overrides,
  };
}

describe("smart auto-launch", () => {
  test("instant launch on clean resume with saved position", () => {
    const ctx = playbackCtx();
    expect(shouldAutoLaunchPlayback(ctx)).toBe(true);
    const entry = resolvePlaybackEpisodeEntry(ctx);
    expect(entry.kind).toBe("auto");
    if (entry.kind === "auto") {
      expect(entry.selection.startAt).toBe(600);
      expect(entry.selection.suppressResumePrompt).toBe(true);
    }
  });

  test("shows menu when provider health is degraded", () => {
    const ctx = playbackCtx({ failedProvider: true });
    expect(shouldAutoLaunchPlayback(ctx)).toBe(false);
    expect(resolvePlaybackEpisodeEntry(ctx).kind).toBe("menu");
  });

  test("shows menu on ambiguous first watch without history", () => {
    const ctx = playbackCtx({
      history: null,
      preselectedEpisode: { season: 1, episode: 1 },
      seasonCount: 3,
    });
    expect(shouldAutoLaunchPlayback(ctx)).toBe(false);
    expect(resolvePlaybackEpisodeEntry(ctx).kind).toBe("menu");
  });

  test("shows menu when history marks episode finished", () => {
    const ctx = playbackCtx({
      history: {
        positionSeconds: 1200,
        durationSeconds: 1200,
        completed: true,
      },
    });
    expect(shouldAutoLaunchPlayback(ctx)).toBe(false);
    expect(resolvePlaybackEpisodeEntry(ctx).kind).toBe("menu");
  });

  test("shows menu when history exists but has no saved position", () => {
    const ctx = playbackCtx({
      history: {
        positionSeconds: 0,
        completed: false,
      },
    });
    expect(shouldAutoLaunchPlayback(ctx)).toBe(false);
  });
});
