import { expect, test } from "bun:test";

import {
  consumeUndoAdvanceResume,
  guardedUndoResumeSeconds,
  pushUndoAdvanceFrame,
  sameEpisode,
  type UndoAdvanceFrame,
} from "@/app/playback-undo-advance";
import type { EpisodeInfo, PlaybackResult } from "@/domain/types";

const E1: EpisodeInfo = { season: 1, episode: 1 };
const E2: EpisodeInfo = { season: 1, episode: 2 };

function resultAt(
  seconds: number,
  duration: number,
  endReason: PlaybackResult["endReason"],
): PlaybackResult {
  return {
    watchedSeconds: seconds,
    duration,
    endReason,
    lastNonZeroPositionSeconds: seconds,
    lastNonZeroDurationSeconds: duration,
  };
}

test("sameEpisode matches season and episode only", () => {
  expect(sameEpisode(E1, { season: 1, episode: 1 })).toBe(true);
  expect(sameEpisode(E1, E2)).toBe(false);
});

test("consumeUndoAdvanceResume restores guarded position when top matches", () => {
  const stack: UndoAdvanceFrame[] = [];
  pushUndoAdvanceFrame(stack, {
    leftEpisode: E1,
    result: resultAt(120, 600, "quit"),
    timing: null,
    thresholdMode: "credits-or-90-percent",
  });
  expect(stack).toHaveLength(1);

  const resume = consumeUndoAdvanceResume(stack, E1, "credits-or-90-percent");
  expect(resume).toBe(120);
  expect(stack).toHaveLength(0);
});

test("consumeUndoAdvanceResume returns 0 when almost finished", () => {
  const stack: UndoAdvanceFrame[] = [];
  pushUndoAdvanceFrame(stack, {
    leftEpisode: E1,
    result: resultAt(598, 600, "quit"),
    timing: null,
    thresholdMode: "credits-or-90-percent",
  });
  const resume = consumeUndoAdvanceResume(stack, E1, "credits-or-90-percent");
  expect(resume).toBe(0);
});

test("consumeUndoAdvanceResume discards non-matching tops until match", () => {
  const stack: UndoAdvanceFrame[] = [];
  pushUndoAdvanceFrame(stack, {
    leftEpisode: E1,
    result: resultAt(50, 600, "quit"),
    timing: null,
    thresholdMode: "credits-or-90-percent",
  });
  pushUndoAdvanceFrame(stack, {
    leftEpisode: E2,
    result: resultAt(80, 600, "quit"),
    timing: null,
    thresholdMode: "credits-or-90-percent",
  });

  const resume = consumeUndoAdvanceResume(stack, E1, "credits-or-90-percent");
  expect(resume).toBe(50);
  expect(stack).toHaveLength(0);
});

test("guardedUndoResumeSeconds rejects very short progress", () => {
  expect(guardedUndoResumeSeconds(5, 600, "credits-or-90-percent")).toBe(0);
});
