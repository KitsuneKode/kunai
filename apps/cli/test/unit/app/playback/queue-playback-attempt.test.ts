import { describe, expect, mock, test } from "bun:test";

import { createQueuePlaybackAttempt } from "@/app/playback/queue-playback-attempt";
import type { QueuePlaybackIntent } from "@/domain/queue/queue-playback-intent";
import type { QueuePlaybackFailureContext } from "@/domain/queue/QueueService";

const INTENT: QueuePlaybackIntent = {
  queueEntryId: "qe-1",
  titleId: "anilist:42",
  mediaKind: "anime",
  absoluteEpisode: 13,
  source: "queue",
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
