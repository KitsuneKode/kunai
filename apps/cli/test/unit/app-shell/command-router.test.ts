import { describe, expect, test } from "bun:test";

import { routePlaybackShellAction, routeSearchShellAction } from "@/app-shell/command-router";
import { resolveCommandContext } from "@/app-shell/commands";
import {
  createInitialState,
  type OverlayState,
  type SessionState,
} from "@/domain/session/SessionState";

describe("routePlaybackShellAction", () => {
  test("returns post-playback episode picker intent without opening a local picker", async () => {
    const result = await routePlaybackShellAction({
      action: "pick-episode",
      container: {} as never,
    });

    expect(result).toBe("pick-episode");
  });

  test("recommendation action during search is handled without mutation", async () => {
    const result = await routeSearchShellAction({
      action: "recommendation",
      container: {} as never,
    });

    expect(result).toBe("handled");
  });

  test("calendar and random actions during search are handled by the search phase", async () => {
    await expect(
      routeSearchShellAction({
        action: "calendar",
        container: {} as never,
      }),
    ).resolves.toBe("handled");
    await expect(
      routeSearchShellAction({
        action: "random",
        container: {} as never,
      }),
    ).resolves.toBe("handled");
  });

  test("notifications action reports disabled attention inbox without opening overlay", async () => {
    const dispatched: unknown[] = [];
    const container = {
      featureFlags: { attentionInbox: false },
      stateManager: {
        dispatch: (action: unknown) => {
          dispatched.push(action);
        },
      },
    };

    const result = await routeSearchShellAction({
      action: "notifications",
      container: container as never,
    });

    expect(result).toBe("handled");
    expect(dispatched).toEqual([
      {
        type: "SET_PLAYBACK_FEEDBACK",
        note: "Attention inbox is disabled.",
      },
    ]);
  });
});

describe("resolveCommandContext scoped surfaces", () => {
  test("post-playback exposes recovery and control actions without destructive commands", () => {
    const commands = resolveCommandContext(baseState(), "postPlayback").map(
      (command) => command.id,
    );

    expect(commands).toEqual([
      "next",
      "previous",
      "replay",
      "recover",
      "recompute",
      "fallback",
      "pick-episode",
      "source",
      "quality",
      "provider",
      "bookmark",
      "follow",
      "mute",
      "mark-watched",
      "playlist",
      "search",
      "recommendation",
      "calendar",
      "downloads",
      "library",
      "history",
      "diagnostics",
    ]);
    expect(commands).not.toContain("quit");
    expect(commands).not.toContain("settings");
    expect(commands).not.toContain("clear-history");
  });

  test("media picker overlays keep command palette local and non-destructive", () => {
    const pickers: readonly OverlayState[] = [
      {
        type: "subtitle_picker",
        id: "subtitle_picker:1",
        options: [{ value: "en", label: "English" }],
      },
      {
        type: "season_picker",
        id: "season_picker:1",
        currentSeason: 1,
        options: [{ value: "1", label: "Season 1" }],
      },
      {
        type: "episode_picker",
        id: "episode_picker:1",
        season: 1,
        options: [{ value: "1", label: "Episode 1" }],
      },
    ];

    for (const picker of pickers) {
      const commands = resolveCommandContext(
        {
          ...baseState(),
          activeModals: [picker],
        },
        "rootOverlay",
      ).map((command) => command.id);

      expect(commands).toEqual(["diagnostics", "help"]);
      expect(commands).not.toContain("quit");
      expect(commands).not.toContain("settings");
      expect(commands).not.toContain("downloads");
      expect(commands).not.toContain("provider");
    }
  });
});

function baseState(): SessionState {
  return {
    ...createInitialState("test-provider", "test-provider", {
      anime: { audio: "sub", subtitle: "en", quality: "auto" },
      series: { audio: "original", subtitle: "en", quality: "auto" },
      movie: { audio: "original", subtitle: "en", quality: "auto" },
    }),
    mode: "anime",
    view: "playback",
    provider: "test-provider",
    defaultProviders: { series: "series-provider", anime: "anime-provider" },
    animeLanguageProfile: { audio: "sub", subtitle: "en", quality: "auto" },
    seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
    movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
    currentTitle: { id: "title-1", type: "series", name: "Demo" },
    currentEpisode: { season: 1, episode: 1 },
    episodeNavigation: {
      hasPrevious: false,
      hasNext: true,
      hasNextSeason: false,
      hasUpcomingNext: false,
    },
    autoplaySessionPaused: false,
    autoskipSessionPaused: false,
    stopAfterCurrent: false,
    stream: null,
    playbackStatus: "finished",
    playbackError: null,
    playbackDetail: null,
    playbackNote: null,
    playbackProblem: null,
    resolveRetryCount: 0,
    searchQuery: "",
    searchResults: [],
    searchState: "idle",
    selectedResultIndex: 0,
    selectedResultId: null,
    activeModals: [],
    pickerResult: null,
  };
}
