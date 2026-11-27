import { describe, expect, test } from "bun:test";

import {
  startEpisodeNavigation,
  startFromEpisodeSelection,
} from "@/app/playback/playback-start-intent";
import { promptlessResumeStartAt } from "@/infra/player/promptless-resume-start";
import { resolveStartingEpisodeChoice } from "@/session-flow";
import type { HistoryProgress } from "@kunai/storage";

describe("promptlessResumeStartAt", () => {
  test("uses the offered resume position only when the resume-choice setting is on", () => {
    expect(
      promptlessResumeStartAt({ startAt: 0, resumePromptAt: 612, resumeStartChoicePrompt: true }),
    ).toBe(612);
    expect(
      promptlessResumeStartAt({ startAt: 0, resumePromptAt: 612, resumeStartChoicePrompt: false }),
    ).toBe(0);
  });

  test("an explicit start position always wins", () => {
    expect(
      promptlessResumeStartAt({ startAt: 44, resumePromptAt: 612, resumeStartChoicePrompt: true }),
    ).toBe(44);
    expect(
      promptlessResumeStartAt({ startAt: 44, resumePromptAt: 612, resumeStartChoicePrompt: false }),
    ).toBe(44);
  });

  test("Restart starts at 0 on a promptless player; navigation still resumes", () => {
    // The composed path Grok's review found broken: the restart selection
    // keeps the saved position for persistent mpv's overlay, and the
    // promptless converter must not turn that offer into the start.
    const history: HistoryProgress = {
      key: "tmdb:1:1:3",
      titleId: "tmdb:1",
      mediaKind: "series",
      title: "Show",
      season: 1,
      episode: 3,
      positionSeconds: 612,
      durationSeconds: 1400,
      completed: false,
      createdAt: "2026-11-27T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
    };
    const restart = resolveStartingEpisodeChoice({
      choice: "restart",
      history,
      isAnime: false,
      nextEpisode: null,
    });
    expect(restart).not.toBeNull();
    const restartIntent = startFromEpisodeSelection(restart!);
    expect(restartIntent.resumePromptAt).toBe(612);
    expect(promptlessResumeStartAt({ ...restartIntent, resumeStartChoicePrompt: true })).toBe(0);

    const navigation = startEpisodeNavigation({ targetResumeSeconds: 612 });
    expect(promptlessResumeStartAt({ ...navigation, resumeStartChoicePrompt: true })).toBe(612);
  });
});
