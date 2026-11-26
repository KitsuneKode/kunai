import { describe, expect, test } from "bun:test";

import {
  recoveryStartIntent,
  startAtResumePoint,
  startEpisodeNavigation,
  startFromBeginning,
} from "@/app/playback/playback-start-intent";

describe("recoveryStartIntent", () => {
  test("a stream that died after playing continues where it reached, without a prompt", () => {
    expect(recoveryStartIntent(754, startAtResumePoint(600))).toEqual(
      startAtResumePoint(754, { suppressResumePrompt: true }),
    );
    expect(recoveryStartIntent(754, startFromBeginning())).toEqual(
      startAtResumePoint(754, { suppressResumePrompt: true }),
    );
  });

  test("a source that failed before reaching a resume keeps that resume, never 0:00", () => {
    const resumeAt = startAtResumePoint(900, { suppressResumePrompt: true });
    expect(recoveryStartIntent(0, resumeAt)).toBe(resumeAt);
    // An unanswered resume prompt stays a prompt; the user had not chosen yet.
    const prompt = startEpisodeNavigation({ targetResumeSeconds: 900 });
    expect(recoveryStartIntent(0, prompt)).toBe(prompt);
  });

  test("a fresh start that failed at once retries from the beginning", () => {
    expect(recoveryStartIntent(0, startFromBeginning())).toEqual(
      startAtResumePoint(0, { suppressResumePrompt: true }),
    );
  });
});
