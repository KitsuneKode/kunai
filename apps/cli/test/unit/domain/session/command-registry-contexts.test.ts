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
      "play-local",
      "watch-online",
      "source",
      "quality",
      "audio",
      "subtitle",
      "memory",
      "mark-anime",
      "mark-series",
      "share",
      "bookmark",
      "follow",
      "unfollow",
      "mute",
      "mark-watched",
      "mark-unwatched",
      "mark-season-watched",
      "mark-up-to-episode",
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
      "clear-cache",
      "reset-provider-health",
      "docs",
      "settings",
      "presence",
      "setup",
      "help",
      "menu",
      "about",
      "update",
      "quit",
    ] satisfies readonly AppCommandId[]);

    expect(COMMAND_CONTEXTS.activePlayback).not.toContain("search");
    expect(COMMAND_CONTEXTS.activePlayback).not.toContain("clear-history");
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
      "bookmark",
      "follow",
      "unfollow",
      "mute",
      "mark-watched",
      "mark-unwatched",
      "mark-season-watched",
      "mark-up-to-episode",
      "pick-episode",
      "download",
      "library",
      "downloads",
      "notifications",
      "watchlist",
      "playlists",
      "up-next",
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
      "play-local",
      "watch-online",
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
      "clear-cache",
      "reset-provider-health",
      "docs",
      "settings",
      "presence",
      "setup",
      "help",
      "menu",
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

  test("resolves bookmark and mark-watched aliases to current-title commands", () => {
    expect(parseCommand("/bookmark")?.id).toBe("bookmark");
    expect(parseCommand("/save-current")?.id).toBe("bookmark");
    expect(parseCommand("/follow")?.id).toBe("follow");
    expect(parseCommand("/unfollow")?.id).toBe("unfollow");
    expect(parseCommand("/mute")?.id).toBe("mute");
    expect(parseCommand("/mark-watched")?.id).toBe("mark-watched");
    expect(parseCommand("/watched")?.id).toBe("mark-watched");
  });

  test("keeps root overlay command order focused on first-run actions", () => {
    expect([...COMMAND_CONTEXTS.rootOverlay].slice(0, 10)).toEqual([
      "continue",
      "watch",
      "watchlist",
      "playlists",
      "up-next",
      "library",
      "downloads",
      "notifications",
      "history",
      "setup",
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
      reason: "Select a title before adding it to Up Next.",
    });
  });

  test("does not offer current-title actions until a title is selected", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });

    expect(resolveCommands(state, ["bookmark"])[0]).toMatchObject({
      id: "bookmark",
      enabled: false,
      reason: "Play or select a title before bookmarking it.",
    });
    expect(resolveCommands(state, ["follow"])[0]).toMatchObject({
      id: "follow",
      enabled: false,
      reason: "Play or select a title before following releases.",
    });
    expect(resolveCommands(state, ["mute"])[0]).toMatchObject({
      id: "mute",
      enabled: false,
      reason: "Play or select a title before muting releases.",
    });
    expect(resolveCommands(state, ["mark-watched"])[0]).toMatchObject({
      id: "mark-watched",
      enabled: false,
      reason: "Play or select a title before marking it watched.",
    });
  });

  test("resolves stable saved-media command vocabulary and compatibility aliases", () => {
    expect(parseCommand("/watchlist")?.id).toBe("watchlist");
    expect(parseCommand("/playlists")?.id).toBe("playlists");
    expect(parseCommand("/playlist")?.id).toBe("playlists");
    expect(parseCommand("/pl")?.id).toBe("playlists");
    expect(parseCommand("/up-next")?.id).toBe("up-next");
    expect(parseCommand("/queue")?.id).toBe("up-next");
  });

  test("uses product-consistent labels for Up Next and recommendations", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });

    expect(
      resolveCommands(state, [
        "downloads",
        "playlists",
        "up-next",
        "playlist-add",
        "recommendation",
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "downloads",
        label: "Download Queue",
      }),
      expect.objectContaining({
        id: "playlists",
        label: "Playlists",
      }),
      expect.objectContaining({
        id: "up-next",
        label: "Up Next",
      }),
      expect.objectContaining({
        id: "playlist-add",
        label: "Add to Up Next",
      }),
      expect.objectContaining({
        id: "recommendation",
        label: "Recommendations",
      }),
    ]);
  });
});
