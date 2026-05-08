import { describe, expect, test } from "bun:test";

import {
  COMMAND_CONTEXTS,
  resolveCommandContext,
  type AppCommandId,
} from "@/domain/session/command-registry";
import { createInitialState } from "@/domain/session/SessionState";

describe("command registry contexts", () => {
  test("keeps active playback commands focused on safe playback actions", () => {
    expect([...COMMAND_CONTEXTS.activePlayback]).toEqual([
      "toggle-autoplay",
      "settings",
      "recover",
      "fallback",
      "pick-episode",
      "streams",
      "source",
      "quality",
      "download",
      "next",
      "previous",
      "history",
      "diagnostics",
      "report-issue",
      "help",
      "about",
      "quit",
    ] satisfies readonly AppCommandId[]);

    expect(COMMAND_CONTEXTS.activePlayback).not.toContain("search");
    expect(COMMAND_CONTEXTS.activePlayback).not.toContain("clear-history");
    expect(COMMAND_CONTEXTS.activePlayback).not.toContain("clear-cache");
  });

  test("resolves context commands through the same availability policy", () => {
    const state = {
      ...createInitialState("vidking", "allanime"),
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
      "search",
      "discover",
      "settings",
      "toggle-mode",
      "provider",
      "history",
      "toggle-autoplay",
      "replay",
      "fallback",
      "streams",
      "source",
      "quality",
      "download",
      "pick-episode",
      "next",
      "previous",
      "next-season",
      "diagnostics",
      "export-diagnostics",
      "report-issue",
      "help",
      "about",
      "quit",
    ] satisfies AppCommandId[]);
  });
});
