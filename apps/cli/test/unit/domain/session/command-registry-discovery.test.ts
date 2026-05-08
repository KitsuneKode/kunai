import { describe, expect, test } from "bun:test";

import { parseCommand, resolveCommands } from "@/domain/session/command-registry";
import { createInitialState } from "@/domain/session/SessionState";

describe("recommendation command", () => {
  test("exposes trending as an explicit browse command", () => {
    const state = createInitialState("vidking", "allanime");

    expect(parseCommand("/trending")?.id).toBe("trending");
    expect(parseCommand("/recommendation")?.id).toBe("recommendation");
    expect(parseCommand("/discover")?.id).toBe("recommendation");
    expect(resolveCommands(state, ["trending"])).toEqual([
      expect.objectContaining({
        id: "trending",
        label: "Trending",
        enabled: true,
      }),
    ]);
  });
});
