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
  });
});
