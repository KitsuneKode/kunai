import type { EpisodeSelection } from "@/session-flow";

export type PlaybackStartIntent = {
  readonly startAt: number;
  readonly resumePromptAt: number;
  readonly suppressResumePrompt: boolean;
};

function normalizeSeconds(seconds: number | undefined): number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function startFromBeginning(): PlaybackStartIntent {
  return { startAt: 0, resumePromptAt: 0, suppressResumePrompt: false };
}

export function startEpisodeNavigation(
  opts: { targetResumeSeconds?: number } = {},
): PlaybackStartIntent {
  return {
    startAt: 0,
    resumePromptAt: normalizeSeconds(opts.targetResumeSeconds),
    suppressResumePrompt: false,
  };
}

export function startAtResumePoint(
  startAt: number,
  opts: { suppressResumePrompt?: boolean } = {},
): PlaybackStartIntent {
  return {
    startAt: normalizeSeconds(startAt),
    resumePromptAt: 0,
    suppressResumePrompt: opts.suppressResumePrompt === true,
  };
}

export function startFromEpisodeSelection(selection: EpisodeSelection): PlaybackStartIntent {
  if (selection.suppressResumePrompt) {
    return startAtResumePoint(selection.startAt ?? 0, {
      suppressResumePrompt: true,
    });
  }

  if (normalizeSeconds(selection.startAt) > 0) {
    return {
      startAt: 0,
      resumePromptAt: normalizeSeconds(selection.startAt),
      suppressResumePrompt: false,
    };
  }

  return startAtResumePoint(selection.startAt ?? 0, {
    suppressResumePrompt: selection.suppressResumePrompt,
  });
}
