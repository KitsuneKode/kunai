import { describe, expect, test } from "bun:test";

import { getModeSwitchTarget } from "@/app/mode-switch";
import { createInitialState } from "@/domain/session/SessionState";

describe("getModeSwitchTarget", () => {
  test("switches series mode to the configured anime provider", () => {
    const state = createInitialState("vidking", "allanime");

    expect(getModeSwitchTarget(state)).toEqual({
      mode: "anime",
      provider: "allanime",
    });
  });

  test("switches anime mode to the configured series provider", () => {
    const state = {
      ...createInitialState("vidking", "allanime"),
      mode: "anime" as const,
      provider: "allanime",
      defaultProviders: {
        series: "cineby",
        anime: "allanime",
      },
    };

    expect(getModeSwitchTarget(state)).toEqual({
      mode: "series",
      provider: "cineby",
    });
  });
});
