import { describe, expect, test } from "bun:test";

import { resolveRootShellSurface } from "@/app-shell/root-shell-state";
import { buildPlaybackBootstrapPresentation } from "@/app/playback/playback-bootstrap-presenter";
import { resolveCommands, type AppCommandId } from "@/domain/session/command-registry";
import { createInitialState, isPlaybackSessionActive } from "@/domain/session/SessionState";
import type { SessionState } from "@/domain/session/SessionState";
import { buildDiagnosticsInsight } from "@/services/diagnostics/diagnostics-insight";

function baseState(): SessionState {
  return createInitialState("vidking", "allanime", {
    anime: { audio: "original", subtitle: "en" },
    series: { audio: "original", subtitle: "none" },
    movie: { audio: "original", subtitle: "en" },
  });
}

function playbackState(status: SessionState["playbackStatus"]): SessionState {
  return {
    ...baseState(),
    view: "playback",
    playbackStatus: status,
    playbackGeneration: { process: 4, cycle: 9 },
    currentTitle: { id: "1396", name: "Breaking Bad", type: "series" },
    currentEpisode: { season: 1, episode: 1 },
    stream: { url: "https://cdn.example/a.m3u8", headers: {}, timestamp: 1 },
  };
}

describe("paused playback stays an active session across surfaces", () => {
  test("the shared selector treats paused as active", () => {
    expect(isPlaybackSessionActive("paused")).toBe(true);
  });

  test("paused playback keeps the playback surface mounted", () => {
    const mount = { hasRootContent: false, hasMountedScreen: true };
    expect(resolveRootShellSurface(playbackState("paused"), mount)).toBe(
      resolveRootShellSurface(playbackState("playing"), mount),
    );
  });

  test("paused playback keeps playback-scoped commands available", () => {
    const paused = resolveCommands(playbackState("paused"));
    const playing = resolveCommands(playbackState("playing"));
    const enabled = (commands: ReturnType<typeof resolveCommands>) =>
      commands.filter((command) => command.enabled).map((command) => command.id);

    for (const id of ["stop", "recover", "diagnostics"] as AppCommandId[]) {
      if (!enabled(playing).includes(id)) continue;
      expect(enabled(paused)).toContain(id);
    }
  });

  test("paused playback stays in the playback bootstrap view without claiming transport advances", () => {
    const paused = buildPlaybackBootstrapPresentation({
      playbackStatus: "paused",
      playbackDetail: null,
      recentEvents: [],
    });

    // Paused is an active playback session, not a resolve/bootstrap state.
    expect(paused.operation).toBe("playing");
  });
});

describe("recovered playback renders healthy state", () => {
  test("a recovered playing status carries no stale degraded copy", () => {
    const recovered: SessionState = {
      ...playbackState("playing"),
      playbackDetail: null,
      playbackNote: null,
    };

    expect(recovered.playbackDetail).toBeNull();
    expect(recovered.playbackNote).toBeNull();
    expect(
      resolveRootShellSurface(recovered, { hasRootContent: false, hasMountedScreen: true }),
    ).toBe("playback");
  });
});

describe("diagnostics current evidence", () => {
  test("reports the same status and generation the session holds", () => {
    const insight = buildDiagnosticsInsight({
      state: playbackState("playing"),
      recentEvents: [],
    });

    expect(insight.currentPlaybackEvidence.playbackStatus).toBe("playing");
    expect(insight.currentPlaybackEvidence.playbackGeneration).toBe("process 4 · cycle 9");
  });

  test("activating a newer generation does not delete earlier event evidence", () => {
    const events = [
      {
        id: "e1",
        at: 1,
        category: "playback",
        message: "Stream stalled",
        operation: "mpv.network.sample",
        status: "failed",
        severity: "degraded",
      },
      {
        id: "e2",
        at: 2,
        category: "playback",
        message: "Trying another source",
        operation: "playback.provider.fallback",
        status: "started",
        severity: "degraded",
      },
    ] as never;

    const insight = buildDiagnosticsInsight({
      state: { ...playbackState("playing"), playbackGeneration: { process: 5, cycle: 1 } },
      recentEvents: events,
    });

    expect(insight.currentPlaybackEvidence.playbackGeneration).toBe("process 5 · cycle 1");
    // Historical evidence survives a newer generation.
    expect(insight.developerEvidence.recentEvents.length).toBe(2);
  });
});
