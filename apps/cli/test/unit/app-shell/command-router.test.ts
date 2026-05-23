import { describe, expect, test } from "bun:test";

import { routePlaybackShellAction, routeSearchShellAction } from "@/app-shell/command-router";
import { resolveCommandContext } from "@/app-shell/commands";
import { createInitialState, type SessionState } from "@/domain/session/SessionState";

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
});

describe("resolveCommandContext scoped surfaces", () => {
  test("post-playback exposes PPS actions without global navigation or destructive commands", () => {
    const commands = resolveCommandContext(baseState(), "postPlayback").map(
      (command) => command.id,
    );

    expect(commands).toEqual([
      "next",
      "replay",
      "pick-episode",
      "streams",
      "source",
      "quality",
      "search",
      "recommendation",
    ]);
    expect(commands).not.toContain("quit");
    expect(commands).not.toContain("settings");
    expect(commands).not.toContain("clear-history");
    expect(commands).not.toContain("downloads");
  });

  test("media picker overlays keep command palette local and non-destructive", () => {
    const pickerTypes = ["subtitle_picker", "source_picker", "quality_picker"] as const;

    for (const type of pickerTypes) {
      const commands = resolveCommandContext(
        {
          ...baseState(),
          activeModals: [
            {
              type,
              id: `${type}:1`,
              options: [{ value: "1080p", label: "1080p" }],
            },
          ],
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
    commandBar: { open: false, query: "", highlightedCommandId: null },
  };
}
