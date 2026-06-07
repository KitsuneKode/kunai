import { describe, expect, test } from "bun:test";

import {
  COMMAND_CONTEXTS,
  parseCommand,
  resolveCommands,
  resolveCommandContext,
  suggestCommands,
  type AppCommandId,
} from "@/domain/session/command-registry";
import { createInitialState } from "@/domain/session/SessionState";

describe("command registry contexts", () => {
  test("keeps active playback commands focused on safe playback actions", () => {
    expect([...COMMAND_CONTEXTS.activePlayback]).toEqual([
      "recover",
      "recompute",
      "fallback",
      "source",
      "quality",
      "audio",
      "subtitle",
      "memory",
      "mark-anime",
      "mark-series",
      "share",
      "pick-episode",
      "download",
      "next",
      "previous",
      "toggle-autoplay",
      "toggle-autoskip",
      "stop-after-current",
      "downloads",
      "library",
      "notifications",
      "history",
      "diagnostics",
      "export-diagnostics",
      "report-issue",
      "docs",
      "settings",
      "presence",
      "setup",
      "help",
      "about",
      "update",
      "quit",
    ] satisfies readonly AppCommandId[]);

    expect(COMMAND_CONTEXTS.activePlayback).not.toContain("search");
    expect(COMMAND_CONTEXTS.activePlayback).not.toContain("clear-history");
    expect(COMMAND_CONTEXTS.activePlayback).not.toContain("clear-cache");
  });

  test("resolves context commands through the same availability policy", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      currentTitle: { id: "tv:1", name: "Demo", type: "series" as const },
      currentEpisode: { season: 1, episode: 2 },
      playbackStatus: "playing" as const,
      stream: { url: "https://example.com/master.m3u8", headers: {}, timestamp: Date.now() },
      episodeNavigation: {
        hasNext: true,
        hasPrevious: true,
        hasNextSeason: false,
        hasUpcomingNext: false,
      },
    };

    const commands = resolveCommandContext(state, "activePlayback");

    expect(commands.map((command) => command.id)).toEqual([...COMMAND_CONTEXTS.activePlayback]);
    expect(commands.find((command) => command.id === "next")?.enabled).toBe(true);
    expect(commands.find((command) => command.id === "pick-episode")?.enabled).toBe(true);
    expect(commands.find((command) => command.id === "download")?.enabled).toBe(true);
  });

  test("keeps post-playback commands as the broader safe menu", () => {
    expect([...COMMAND_CONTEXTS.postPlayback]).toEqual([
      "next",
      "replay",
      "mark-anime",
      "mark-series",
      "share",
      "pick-episode",
      "download",
      "library",
      "downloads",
      "notifications",
      "watchlist",
      "playlist",
      "stats",
      "recommendation",
      "random",
      "surprise",
      "calendar",
      "anime-calendar",
      "series-calendar",
      "search",
      "history",
      "recover",
      "recompute",
      "fallback",
      "source",
      "quality",
      "audio",
      "subtitle",
      "toggle-autoplay",
      "toggle-autoskip",
      "stop-after-current",
      "previous",
      "next-season",
      "provider",
      "toggle-mode",
      "diagnostics",
      "export-diagnostics",
      "report-issue",
      "docs",
      "settings",
      "presence",
      "setup",
      "help",
      "about",
      "update",
      "quit",
    ] satisfies AppCommandId[]);
  });

  test("keeps offline as the completed library command, not enqueue", () => {
    expect(parseCommand("/offline")?.id).toBe("library");
    expect(parseCommand("/download")?.id).toBe("download");
    expect(parseCommand("/docs")?.id).toBe("docs");
  });

  test("resolves /c and /continue aliases to the continue command", () => {
    expect(parseCommand("/c")?.id).toBe("continue");
    expect(parseCommand("/continue")?.id).toBe("continue");
  });

  test("suggests primary /continue before secondary /config when typing /con", () => {
    expect(suggestCommands("/con", COMMAND_CONTEXTS.rootOverlay)[0]?.id).toBe("continue");
  });

  test("resolves /memory aliases to the playback memory command", () => {
    expect(parseCommand("/memory")?.id).toBe("memory");
    expect(parseCommand("/mem")?.id).toBe("memory");
  });

  test("keeps root overlay command order focused on first-run actions", () => {
    expect([...COMMAND_CONTEXTS.rootOverlay].slice(0, 10)).toEqual([
      "continue",
      "watch",
      "watchlist",
      "playlist",
      "stats",
      "sync",
      "library",
      "downloads",
      "notifications",
      "history",
    ] satisfies readonly AppCommandId[]);
  });

  test("does not offer add-to-playlist until a title is selected", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });

    expect(resolveCommands(state, ["playlist-add"])[0]).toMatchObject({
      id: "playlist-add",
      enabled: false,
      reason: "Select a title before adding it to the playlist.",
    });
  });

  test("uses product-consistent labels for queue and recommendations", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });

    expect(resolveCommands(state, ["downloads", "recommendation"])).toEqual([
      expect.objectContaining({
        id: "downloads",
        label: "Download Queue",
      }),
      expect.objectContaining({
        id: "recommendation",
        label: "Recommendations",
      }),
    ]);
  });
});
