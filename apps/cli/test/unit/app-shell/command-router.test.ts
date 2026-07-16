import { describe, expect, test } from "bun:test";

import {
  resolveCommandsForPaletteSurface,
  routePlaybackShellAction,
  routeSearchShellAction,
} from "@/app-shell/command-router";
import { resolveCommandContext } from "@/app-shell/commands";
import { type OverlayState, type SessionState } from "@/domain/session/SessionState";

import { createSessionStateFixture } from "../../support/session-state-fixture";

describe("resolveCommandsForPaletteSurface", () => {
  test("browse palette excludes Experimental command group by default", () => {
    const commands = resolveCommandsForPaletteSurface(baseState(), "browse").map(
      (command) => command.id,
    );

    expect(commands).toContain("watchlist");
    expect(commands).toContain("up-next");
    expect(commands).toContain("stats");
    expect(commands).not.toContain("sync");
    expect(commands).not.toContain("random");
    expect(commands).not.toContain("surprise");
    expect(commands).not.toContain("favorites");
  });

  test("post-play palette excludes Experimental command group by default", () => {
    const commands = resolveCommandsForPaletteSurface(baseState(), "post-play").map(
      (command) => command.id,
    );

    expect(commands).toContain("next");
    expect(commands).toContain("recommendation");
    expect(commands).toContain("stats");
    expect(commands).not.toContain("random");
    expect(commands).not.toContain("surprise");
    expect(commands).not.toContain("sync");
  });
});

describe("routePlaybackShellAction", () => {
  test("returns post-playback episode picker intent without opening a local picker", async () => {
    const result = await routePlaybackShellAction({
      action: "pick-episode",
      container: {} as never,
    });

    expect(result).toBe("pick-episode");
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

  test("routes browse stats through the real palette route", async () => {
    const actions: string[] = [];
    const result = await routeSearchShellAction({
      action: "stats",
      container: {} as never,
      workflows: {
        resolveQuit: async () => "quit",
        runSetup: async () => "handled",
        runAction: async (action) => {
          actions.push(action);
          return "handled";
        },
      },
    });

    expect(result).toBe("handled");
    expect(actions).toEqual(["stats"]);
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
      "unfollow",
      "mute",
      "mark-watched",
      "mark-unwatched",
      "mark-season-watched",
      "mark-up-to-episode",
      "playlists",
      "up-next",
      "stats",
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

  test("normal root overlays and active playback expose stats", () => {
    expect(
      resolveCommandContext(baseState(), "rootOverlay").map((command) => command.id),
    ).toContain("stats");
    expect(
      resolveCommandContext(baseState(), "activePlayback").map((command) => command.id),
    ).toContain("stats");
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
  return createSessionStateFixture(
    {
      mode: "anime",
      view: "playback",
      provider: "test-provider",
      defaultProviders: { series: "series-provider", anime: "anime-provider", youtube: "youtube" },
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
    },
    { defaultProvider: "test-provider", defaultAnimeProvider: "test-provider" },
  );
}
