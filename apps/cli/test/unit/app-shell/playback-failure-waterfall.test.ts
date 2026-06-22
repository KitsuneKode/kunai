import { describe, expect, test } from "bun:test";

import { buildPlaybackFailureWaterfall } from "@/app-shell/playback-failure-waterfall";
import { createInitialState, type SessionState } from "@/domain/session/SessionState";
import type { DiagnosticEvent } from "@/services/diagnostics/diagnostic-event";

const profiles = {
  anime: { audio: "sub", subtitle: "en" },
  series: { audio: "original", subtitle: "en" },
  movie: { audio: "original", subtitle: "en" },
} as const;

function playbackState(): SessionState {
  return {
    ...createInitialState("videasy", "allanime", profiles),
    currentTitle: { id: "248244", type: "series", name: "Undercover High School" },
    currentEpisode: { season: 1, episode: 4 },
    playbackStatus: "error",
  };
}

function timelineEvent(context: Record<string, unknown>): DiagnosticEvent {
  return {
    timestamp: 1,
    level: "warn",
    category: "provider",
    operation: "provider.resolve.timeline",
    message: "No playable stream found",
    titleId: "248244",
    providerId: "videasy",
    season: 1,
    episode: 4,
    context,
  };
}

describe("buildPlaybackFailureWaterfall", () => {
  test("projects source attempts into compact failed rows", () => {
    const model = buildPlaybackFailureWaterfall({
      state: playbackState(),
      recentEvents: [
        timelineEvent({
          sourceAttempts: [
            {
              type: "source:start",
              sourceId: "source:videasy:mb-flix",
              serverId: "mb-flix",
              message: "Luffy",
            },
            {
              type: "source:failed",
              sourceId: "source:videasy:mb-flix",
              serverId: "mb-flix",
              failureClass: "candidate-empty",
              message: "Luffy failed",
            },
            {
              type: "source:failed",
              sourceId: "source:videasy:cdn",
              serverId: "cdn",
              failureClass: "timeout",
              message: "Zoro failed",
            },
          ],
        }),
      ],
    });

    expect(model).toMatchObject({
      title: "Source attempts",
      rows: [
        { label: "mb-flix", status: "failed", detail: "candidate-empty" },
        { label: "cdn", status: "failed", detail: "timeout" },
      ],
    });
  });

  test("uses provider attempts when source attempts are unavailable", () => {
    const model = buildPlaybackFailureWaterfall({
      state: playbackState(),
      recentEvents: [
        timelineEvent({
          attemptTimeline: [
            {
              providerId: "videasy",
              status: "failed",
              failureClass: "provider-empty",
              summary: "No stream",
            },
            {
              providerId: "rivestream",
              status: "succeeded",
              summary: null,
            },
          ],
        }),
      ],
    });

    expect(model).toMatchObject({
      title: "Provider attempts",
      rows: [
        { label: "videasy", status: "failed", detail: "provider-empty" },
        { label: "rivestream", status: "succeeded", detail: null },
      ],
    });
  });

  test("ignores stale timelines from another episode", () => {
    const model = buildPlaybackFailureWaterfall({
      state: playbackState(),
      recentEvents: [
        {
          ...timelineEvent({
            sourceAttempts: [{ type: "source:failed", serverId: "mb-flix" }],
          }),
          episode: 3,
        },
      ],
    });

    expect(model).toBeNull();
  });
});
