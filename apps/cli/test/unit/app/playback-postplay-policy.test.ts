import { expect, test } from "bun:test";

import {
  canAutoContinueIntoRecommendation,
  canResumePlayback,
  isNearEndVoluntaryQuit,
} from "@/app/playback/playback-postplay-policy";

const nearEndBase = {
  endReason: "quit",
  quitNearEndBehavior: "continue",
  sessionMode: "autoplay-chain",
  autoplayPaused: false,
  stopAfterCurrent: false,
  hasNextEpisode: true,
  endedNearNaturalEnd: true,
} as const;

test("isNearEndVoluntaryQuit: true only when every condition holds", () => {
  expect(isNearEndVoluntaryQuit(nearEndBase)).toBe(true);
});

test("isNearEndVoluntaryQuit: false on any disqualifier", () => {
  expect(isNearEndVoluntaryQuit({ ...nearEndBase, endReason: "eof" })).toBe(false);
  expect(isNearEndVoluntaryQuit({ ...nearEndBase, quitNearEndBehavior: "menu" })).toBe(false);
  expect(isNearEndVoluntaryQuit({ ...nearEndBase, sessionMode: "single" })).toBe(false);
  expect(isNearEndVoluntaryQuit({ ...nearEndBase, autoplayPaused: true })).toBe(false);
  expect(isNearEndVoluntaryQuit({ ...nearEndBase, stopAfterCurrent: true })).toBe(false);
  expect(isNearEndVoluntaryQuit({ ...nearEndBase, hasNextEpisode: false })).toBe(false);
  expect(isNearEndVoluntaryQuit({ ...nearEndBase, endedNearNaturalEnd: false })).toBe(false);
});

test("canResumePlayback: needs >10s watched and not effectively at the end", () => {
  expect(
    canResumePlayback({
      resumeSeconds: 300,
      durationSeconds: 1400,
      endReason: "quit",
      endedNearNaturalEnd: false,
    }),
  ).toBe(true);
  // <= 10s watched
  expect(
    canResumePlayback({
      resumeSeconds: 8,
      durationSeconds: 1400,
      endReason: "quit",
      endedNearNaturalEnd: false,
    }),
  ).toBe(false);
  // within 5s of the end
  expect(
    canResumePlayback({
      resumeSeconds: 1398,
      durationSeconds: 1400,
      endReason: "quit",
      endedNearNaturalEnd: false,
    }),
  ).toBe(false);
  // natural EOF finish → no resume
  expect(
    canResumePlayback({
      resumeSeconds: 300,
      durationSeconds: 1400,
      endReason: "eof",
      endedNearNaturalEnd: true,
    }),
  ).toBe(false);
  // unknown duration still resumes when there is watched time
  expect(
    canResumePlayback({
      resumeSeconds: 300,
      durationSeconds: 0,
      endReason: "quit",
      endedNearNaturalEnd: false,
    }),
  ).toBe(true);
});

const autoContinueBase = {
  sessionMode: "autoplay-chain",
  hasNextEpisode: false,
  endReason: "eof",
  autoplayPaused: false,
  autoplaySessionPaused: false,
  aborted: false,
  hasQueuedNext: false,
  autoplayRecommendationsEnabled: true,
} as const;

test("canAutoContinueIntoRecommendation: true at a clean end of series with recs on", () => {
  expect(canAutoContinueIntoRecommendation(autoContinueBase)).toBe(true);
});

test("canAutoContinueIntoRecommendation: false when blocked", () => {
  expect(canAutoContinueIntoRecommendation({ ...autoContinueBase, sessionMode: "single" })).toBe(
    false,
  );
  expect(canAutoContinueIntoRecommendation({ ...autoContinueBase, hasNextEpisode: true })).toBe(
    false,
  );
  expect(canAutoContinueIntoRecommendation({ ...autoContinueBase, endReason: "quit" })).toBe(false);
  expect(canAutoContinueIntoRecommendation({ ...autoContinueBase, autoplayPaused: true })).toBe(
    false,
  );
  expect(
    canAutoContinueIntoRecommendation({ ...autoContinueBase, autoplaySessionPaused: true }),
  ).toBe(false);
  expect(canAutoContinueIntoRecommendation({ ...autoContinueBase, aborted: true })).toBe(false);
  expect(canAutoContinueIntoRecommendation({ ...autoContinueBase, hasQueuedNext: true })).toBe(
    false,
  );
  expect(
    canAutoContinueIntoRecommendation({
      ...autoContinueBase,
      autoplayRecommendationsEnabled: false,
    }),
  ).toBe(false);
});
