import { describe, expect, test } from "bun:test";

import {
  sharedStartOverride,
  startAtResumePoint,
  startEpisodeNavigation,
  startFromBeginning,
  startFromEpisodeSelection,
} from "@/app/playback/playback-start-intent";

describe("playback start intent", () => {
  test("continues directly when the picker chose resume", () => {
    expect(
      startFromEpisodeSelection({
        season: 4,
        episode: 2,
        startAt: 1334,
        suppressResumePrompt: true,
      }),
    ).toEqual({
      startAt: 1334,
      resumePromptAt: 0,
      suppressResumePrompt: true,
    });
  });

  test("starts selected episodes from the beginning while offering manual resume", () => {
    expect(
      startFromEpisodeSelection({
        season: 4,
        episode: 2,
        startAt: 1334,
      }),
    ).toEqual({
      startAt: 0,
      resumePromptAt: 1334,
      suppressResumePrompt: false,
    });
  });

  test("normalizes start-over and invalid offsets to beginning", () => {
    expect(startFromBeginning()).toEqual({
      startAt: 0,
      resumePromptAt: 0,
      suppressResumePrompt: false,
    });
    expect(startAtResumePoint(-1, { suppressResumePrompt: true })).toEqual({
      startAt: 0,
      resumePromptAt: 0,
      suppressResumePrompt: true,
    });
  });

  test("starts episode navigation from the beginning while offering target history resume", () => {
    expect(startEpisodeNavigation({ targetResumeSeconds: 612 })).toEqual({
      startAt: 0,
      resumePromptAt: 612,
      suppressResumePrompt: false,
    });
  });
});

describe("sharedStartOverride", () => {
  test("a shared timestamp starts there and skips the resume prompt", () => {
    expect(sharedStartOverride(120)).toEqual({
      startAt: 120,
      resumePromptAt: 0,
      suppressResumePrompt: true,
    });
  });

  test("t=0 is an explicit restart, not a missing timestamp", () => {
    expect(sharedStartOverride(0)).toEqual({
      startAt: 0,
      resumePromptAt: 0,
      suppressResumePrompt: true,
    });
  });

  test("no usable timestamp leaves the history-driven start alone", () => {
    expect(sharedStartOverride(undefined)).toBeNull();
    expect(sharedStartOverride(-5)).toBeNull();
    expect(sharedStartOverride(Number.NaN)).toBeNull();
  });
});
