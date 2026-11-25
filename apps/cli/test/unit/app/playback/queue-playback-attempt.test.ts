import { describe, expect, mock, test } from "bun:test";

import {
  createQueuePlaybackAttempt,
  startedEpisodeMatchesClaim,
} from "@/app/playback/queue-playback-attempt";
import type { QueuePlaybackIntent } from "@/domain/queue/queue-playback-intent";
import type { QueuePlaybackFailureContext } from "@/domain/queue/QueueService";

const INTENT: QueuePlaybackIntent = {
  queueEntryId: "qe-1",
  titleId: "anilist:42",
  mediaKind: "anime",
  absoluteEpisode: 13,
};

describe("createQueuePlaybackAttempt", () => {
  test("acknowledgeStarted marks once and makes rollback a no-op", () => {
    const acknowledgePlaybackStarted = mock(() => true);
    const rollbackBeforeStart = mock(() => true);
    const attempt = createQueuePlaybackAttempt(
      { acknowledgePlaybackStarted, rollbackBeforeStart },
      INTENT,
      { now: () => "2026-07-20T10:00:00.000Z" },
    );

    expect(attempt.acknowledged).toBe(false);
    expect(attempt.acknowledgeStarted("2026-07-20T10:01:00.000Z")).toBe(true);
    expect(attempt.acknowledged).toBe(true);
    expect(acknowledgePlaybackStarted).toHaveBeenCalledTimes(1);
    expect(acknowledgePlaybackStarted).toHaveBeenCalledWith(INTENT, "2026-07-20T10:01:00.000Z");

    expect(attempt.acknowledgeStarted()).toBe(true);
    expect(acknowledgePlaybackStarted).toHaveBeenCalledTimes(1);

    expect(attempt.rollbackIfUnacknowledged("mpv-launch-failed")).toBe(false);
    expect(rollbackBeforeStart).not.toHaveBeenCalled();
  });

  test("rollbackIfUnacknowledged restores with current stage", () => {
    const acknowledgePlaybackStarted = mock(() => true);
    const rollbackBeforeStart = mock(() => true);
    const attempt = createQueuePlaybackAttempt(
      { acknowledgePlaybackStarted, rollbackBeforeStart },
      INTENT,
      { now: () => "2026-07-20T11:00:00.000Z" },
    );

    attempt.setStage("provider-resolution");
    expect(attempt.rollbackIfUnacknowledged("provider-exhausted", "all providers failed")).toBe(
      true,
    );

    const failure: QueuePlaybackFailureContext = {
      code: "provider-exhausted",
      stage: "provider-resolution",
      at: "2026-07-20T11:00:00.000Z",
      detail: "all providers failed",
    };
    expect(rollbackBeforeStart).toHaveBeenCalledWith(INTENT, failure);
    expect(attempt.acknowledged).toBe(false);
    expect(attempt.rollbackIfUnacknowledged("playback-aborted")).toBe(false);
    expect(rollbackBeforeStart).toHaveBeenCalledTimes(1);
  });

  test("failed acknowledge does not flip acknowledged", () => {
    const attempt = createQueuePlaybackAttempt(
      {
        acknowledgePlaybackStarted: () => false,
        rollbackBeforeStart: () => true,
      },
      INTENT,
    );

    expect(attempt.acknowledgeStarted()).toBe(false);
    expect(attempt.acknowledged).toBe(false);
    expect(attempt.rollbackIfUnacknowledged("playback-aborted")).toBe(true);
  });
});

/**
 * Sol review #1: a claimed S02E07 was acknowledged by row id when the viewer
 * started S01E01 instead, so the row they meant to watch was marked played.
 */
describe("a claim naming an episode is consumed only by that episode", () => {
  const SERIES: QueuePlaybackIntent = {
    queueEntryId: "qe-2",
    titleId: "tmdb:7",
    mediaKind: "series",
    season: 2,
    episode: 7,
  };

  test("a different episode starting leaves the row for rollback", () => {
    const acknowledgePlaybackStarted = mock(() => true);
    const rollbackBeforeStart = mock(() => true);
    const attempt = createQueuePlaybackAttempt(
      { acknowledgePlaybackStarted, rollbackBeforeStart },
      SERIES,
    );

    expect(attempt.acknowledgeStarted(undefined, { season: 1, episode: 1 })).toBe(false);
    expect(acknowledgePlaybackStarted).not.toHaveBeenCalled();
    // The phase's exit then restores it to pending.
    expect(attempt.rollbackIfUnacknowledged("playback-aborted")).toBe(true);
  });

  test("the named episode starting consumes it", () => {
    const acknowledgePlaybackStarted = mock(() => true);
    const attempt = createQueuePlaybackAttempt(
      { acknowledgePlaybackStarted, rollbackBeforeStart: mock(() => true) },
      SERIES,
    );

    expect(attempt.acknowledgeStarted(undefined, { season: 2, episode: 7 })).toBe(true);
    expect(acknowledgePlaybackStarted).toHaveBeenCalledTimes(1);
  });

  test("anime matches by absolute number in either field; title-level rows match anything", () => {
    expect(startedEpisodeMatchesClaim(INTENT, { season: 1, episode: 13 })).toBe(true);
    expect(startedEpisodeMatchesClaim(INTENT, { season: 2, episode: 1, absoluteEpisode: 13 })).toBe(
      true,
    );
    expect(startedEpisodeMatchesClaim(INTENT, { season: 1, episode: 12 })).toBe(false);
    const titleLevel: QueuePlaybackIntent = {
      queueEntryId: "q",
      titleId: "t",
      mediaKind: "series",
    };
    expect(startedEpisodeMatchesClaim(titleLevel, { season: 3, episode: 4 })).toBe(true);
    const movie: QueuePlaybackIntent = { queueEntryId: "m", titleId: "t", mediaKind: "movie" };
    expect(startedEpisodeMatchesClaim(movie, { season: 1, episode: 1 })).toBe(true);
  });
});
