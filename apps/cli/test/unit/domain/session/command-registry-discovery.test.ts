import { describe, expect, test } from "bun:test";

import { parseCommand, resolveCommands } from "@/domain/session/command-registry";
import { createInitialState } from "@/domain/session/SessionState";

describe("recommendation command", () => {
  test("exposes trending as an explicit browse command", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });

    expect(parseCommand("/trending")?.id).toBe("trending");
    expect(parseCommand("/recommendation")?.id).toBe("recommendation");
    expect(parseCommand("/discover")?.id).toBe("recommendation");
    expect(parseCommand("/calendar")?.id).toBe("calendar");
    expect(parseCommand("/airing")?.id).toBe("calendar");
    expect(parseCommand("/random")?.id).toBe("random");
    expect(parseCommand("/spin")?.id).toBe("random");
    expect(parseCommand("/surprise")?.id).toBe("surprise");
    expect(parseCommand("/offline")?.id).toBe("library");
    expect(parseCommand("/downloads")?.id).toBe("downloads");
    expect(parseCommand("/notifications")?.id).toBe("notifications");
    expect(parseCommand("/inbox")?.id).toBe("notifications");
    expect(parseCommand("/tracks")?.id).toBe("streams");
    expect(parseCommand("/audio")?.id).toBe("streams");
    expect(parseCommand("/subtitles")?.id).toBe("streams");
    expect(resolveCommands(state, ["trending"])).toEqual([
      expect.objectContaining({
        id: "trending",
        label: "Trending",
        enabled: true,
      }),
    ]);
    expect(resolveCommands(state, ["calendar", "random"]).map((command) => command.id)).toEqual([
      "calendar",
      "random",
    ]);
    expect(resolveCommands(state, ["surprise"])[0]).toMatchObject({
      id: "surprise",
      label: "Surprise Me",
      enabled: true,
    });
    expect(resolveCommands(state, ["recommendation"])[0]).toMatchObject({
      id: "recommendation",
      label: "Discover",
      enabled: true,
    });
  });
});
