import { describe, expect, test } from "bun:test";

import { getModeSwitchTarget } from "@/app/session/mode-switch";
import { createInitialState } from "@/domain/session/SessionState";

describe("getModeSwitchTarget", () => {
  test("switches series mode to the configured anime provider", () => {
    const state = createInitialState("vidking", "allanime", {
      anime: { audio: "original", subtitle: "en" },
      series: { audio: "original", subtitle: "none" },
      movie: { audio: "original", subtitle: "en" },
    });

    expect(getModeSwitchTarget(state)).toEqual({
      mode: "anime",
      provider: "allanime",
    });
  });

  test("switches anime mode to the configured series provider", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      mode: "anime" as const,
      provider: "allanime",
      defaultProviders: {
        series: "cineby",
        anime: "allanime",
        youtube: "youtube",
      },
    };

    expect(getModeSwitchTarget(state)).toEqual({
      mode: "youtube",
      provider: "youtube",
    });
  });

  test("switches youtube mode to the configured series provider", () => {
    const state = {
      ...createInitialState("vidking", "allanime", {
        anime: { audio: "original", subtitle: "en" },
        series: { audio: "original", subtitle: "none" },
        movie: { audio: "original", subtitle: "en" },
      }),
      mode: "youtube" as const,
      provider: "youtube",
      defaultProviders: {
        series: "cineby",
        anime: "allanime",
        youtube: "youtube",
      },
    };

    expect(getModeSwitchTarget(state)).toEqual({
      mode: "series",
      provider: "cineby",
    });
  });
});
