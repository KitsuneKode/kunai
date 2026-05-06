import type { EpisodeSelection } from "@/session-flow";

export type PlaybackStartIntent = {
  readonly startAt: number;
  readonly suppressResumePrompt: boolean;
};

export function startFromBeginning(): PlaybackStartIntent {
  return { startAt: 0, suppressResumePrompt: false };
}

export function startEpisodeNavigation(
  _opts: { targetResumeSeconds?: number } = {},
): PlaybackStartIntent {
  return startFromBeginning();
}

export function startAtResumePoint(
  startAt: number,
  opts: { suppressResumePrompt?: boolean } = {},
): PlaybackStartIntent {
  return {
    startAt: Number.isFinite(startAt) && startAt > 0 ? startAt : 0,
    suppressResumePrompt: opts.suppressResumePrompt === true,
  };
}

export function startFromEpisodeSelection(selection: EpisodeSelection): PlaybackStartIntent {
  return startAtResumePoint(selection.startAt ?? 0, {
    suppressResumePrompt: selection.suppressResumePrompt,
  });
}
