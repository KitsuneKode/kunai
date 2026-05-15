import { describe, expect, test } from "bun:test";

import {
  COMMAND_CONTEXTS,
  parseCommand,
  resolveCommandContext,
  type AppCommandId,
} from "@/domain/session/command-registry";
import { createInitialState } from "@/domain/session/SessionState";

describe("command registry contexts", () => {
  test("keeps active playback commands focused on safe playback actions", () => {
    expect([...COMMAND_CONTEXTS.activePlayback]).toEqual([
      "recover",
      "fallback",
      "streams",
      "source",
      "quality",
      "pick-episode",
      "download",
      "next",
      "previous",
      "toggle-autoplay",
      "downloads",
      "library",
      "history",
      "diagnostics",
      "export-diagnostics",
      "report-issue",
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
      "pick-episode",
      "download",
      "library",
      "downloads",
      "recommendation",
      "random",
      "surprise",
      "calendar",
      "search",
      "history",
      "recover",
      "fallback",
      "streams",
      "source",
      "quality",
      "toggle-autoplay",
      "previous",
      "next-season",
      "provider",
      "toggle-mode",
      "diagnostics",
      "export-diagnostics",
      "report-issue",
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
  });

  test("keeps root overlay command order focused on first-run actions", () => {
    expect([...COMMAND_CONTEXTS.rootOverlay].slice(0, 8)).toEqual([
      "library",
      "downloads",
      "history",
      "setup",
      "settings",
      "provider",
      "presence",
      "diagnostics",
    ] satisfies readonly AppCommandId[]);
  });
});
