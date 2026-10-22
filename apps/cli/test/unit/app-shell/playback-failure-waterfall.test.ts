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

  test("clamps maxRows=0 to one row instead of an empty titled model", () => {
    const model = buildPlaybackFailureWaterfall({
      state: playbackState(),
      recentEvents: [
        timelineEvent({
          sourceAttempts: [
            { type: "source:failed", serverId: "a" },
            { type: "source:failed", serverId: "b" },
          ],
        }),
      ],
      maxRows: 0,
    });

    expect(model?.rows.length).toBe(1);
  });

  test("does not repeat the stage in the detail when the label carries it", () => {
    // Regression: a wings-family seed failure rendered
    // "x wings-cdn · seed · seed · seed-unavailable" — the stage appeared in
    // both the label and the detail.
    const model = buildPlaybackFailureWaterfall({
      state: playbackState(),
      recentEvents: [
        timelineEvent({
          sourceAttempts: [
            {
              type: "source:failed",
              sourceId: "source:videasy:wings-cdn",
              serverId: "wings-cdn",
              stage: "seed",
              failureClass: "seed-unavailable",
              message: "Videasy seed unavailable",
            },
            {
              type: "source:start",
              sourceId: "source:videasy:wings-neon2",
              serverId: "wings-neon2",
              stage: "seed",
            },
          ],
        }),
      ],
    });

    expect(model).toMatchObject({
      title: "Source attempts",
      rows: [
        { label: "wings-cdn · seed", status: "failed", detail: "seed-unavailable" },
        { label: "wings-neon2 · seed", status: "running", detail: "tried" },
      ],
    });
  });

  test("keeps the stage in the detail when the label has no server identity", () => {
    const model = buildPlaybackFailureWaterfall({
      state: playbackState(),
      recentEvents: [
        timelineEvent({
          sourceAttempts: [
            {
              type: "source:failed",
              stage: "seed",
              failureClass: "seed-unavailable",
              message: "seed fetch failed",
            },
          ],
        }),
      ],
    });

    expect(model?.rows[0]).toMatchObject({
      status: "failed",
      detail: "seed · seed-unavailable",
    });
  });
});

test("source-only waterfall labels carry the stage once", () => {
  const model = buildPlaybackFailureWaterfall({
    state: playbackState(),
    recentEvents: [
      timelineEvent({
        sourceAttempts: [
          {
            type: "source:failed",
            sourceId: "source:videasy:solo",
            stage: "seed",
            failureClass: "unavailable",
          },
        ],
      }),
    ],
  });
  expect(model?.rows[0]?.detail).toBe("unavailable");
});
