import { describe, expect, test } from "bun:test";

import { evaluateAutoAdvanceNextUp, shouldOfferAutoAdvance } from "@/app/playback/playback-advance";
import type { QueueEntry } from "@kunai/storage";

const guards = {
  endReason: "eof",
  autoplayPaused: false,
  autoplaySessionPaused: false,
  signalAborted: false,
};

const queueHead = {
  id: "q1",
  title: "Queued",
  mediaKind: "series",
  titleId: "t2",
} as unknown as QueueEntry;

describe("shouldOfferAutoAdvance", () => {
  test("requires natural eof without pause or abort", () => {
    expect(shouldOfferAutoAdvance(guards)).toBe(true);
    expect(shouldOfferAutoAdvance({ ...guards, endReason: "quit" })).toBe(false);
    expect(shouldOfferAutoAdvance({ ...guards, autoplayPaused: true })).toBe(false);
    expect(shouldOfferAutoAdvance({ ...guards, signalAborted: true })).toBe(false);
  });
});

describe("evaluateAutoAdvanceNextUp", () => {
  test("returns null when guards block advance", () => {
    expect(
      evaluateAutoAdvanceNextUp({
        guards: { ...guards, autoplayPaused: true },
        nextEpisode: { season: 1, episode: 2 },
        queueHead,
        topRecommendation: null,
        seriesDone: false,
        autoplayRecommendations: true,
      }),
    ).toBeNull();
  });

  test("delegates to resolveNextUp when guards allow", () => {
    expect(
      evaluateAutoAdvanceNextUp({
        guards,
        nextEpisode: null,
        queueHead,
        topRecommendation: { mediaKind: "series", titleId: "t3", title: "Rec" },
        seriesDone: true,
        autoplayRecommendations: true,
      }),
    ).toEqual({ kind: "queue", entry: queueHead });
  });
});
