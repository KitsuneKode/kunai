import { describe, expect, test } from "bun:test";

import {
  startAtResumePoint,
  startEpisodeNavigation,
  startFromBeginning,
  startFromEpisodeSelection,
} from "@/app/playback-start-intent";

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
