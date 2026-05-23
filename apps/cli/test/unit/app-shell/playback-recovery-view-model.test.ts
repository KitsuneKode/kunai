import { describe, expect, test } from "bun:test";

import { buildPlaybackRecoveryViewModel } from "@/app-shell/playback-recovery-view-model";
import type { LoadingShellState } from "@/app-shell/types";

function baseState(overrides: Partial<LoadingShellState>): LoadingShellState {
  return {
    title: "The Boys",
    subtitle: "S01E01",
    operation: "playing",
    ...overrides,
  };
}

describe("buildPlaybackRecoveryViewModel", () => {
  test("stream stalled promotes recover and fallback without next", () => {
    const model = buildPlaybackRecoveryViewModel(
      baseState({
        bufferHealth: "stalled",
        latestIssue: "Stream stalled",
        fallbackAvailable: true,
        hasNextEpisode: true,
      }),
    );
    expect(model?.state.kind).toBe("error");
    expect(model?.state.title).toBe("Stream stalled");
    expect(model?.actions.map((action) => action.id)).toEqual([
      "recover",
      "fallback",
      "sources",
      "diagnostics",
    ]);
  });

  test("playback did not start never promotes next", () => {
    const model = buildPlaybackRecoveryViewModel(
      baseState({
        operation: "loading",
        latestIssue: "Playback did not start",
        hasNextEpisode: true,
      }),
    );
    expect(model?.actions.some((action) => action.id === "next")).toBe(false);
    expect(model?.state.title).toBe("Playback did not start");
  });

  test("provider degraded is warning, not hard error", () => {
    const model = buildPlaybackRecoveryViewModel(
      baseState({
        operation: "resolving",
        latestIssue: "Provider/CDN may be degraded. Try fallback or open diagnostics.",
        fallbackAvailable: true,
      }),
    );
    expect(model?.state.kind).toBe("info");
    expect(model?.state.title).toBe("Provider degraded");
  });

  test("healthy playback returns null", () => {
    expect(buildPlaybackRecoveryViewModel(baseState({ bufferHealth: "healthy" }))).toBeNull();
  });
});
