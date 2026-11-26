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

/**
 * Where a recovered attempt starts. A source that died after playing continues
 * from where it reached, without a prompt. One that failed before reaching its
 * intended start (a resume at 15:00 that never decoded) keeps that intent
 * rather than restarting the episode from 0:00.
 */
export function recoveryStartIntent(
  reachedSeconds: number,
  attempted: PlaybackStartIntent,
): PlaybackStartIntent {
  const intended = Math.max(attempted.startAt, attempted.resumePromptAt);
  if (reachedSeconds < intended) return attempted;
  return startAtResumePoint(reachedSeconds, { suppressResumePrompt: true });
}

/**
 * The start a share link's `t=` imposes on the first play, or null without one.
 *
 * An explicit timestamp is an instruction, so it wins over local history and
 * skips the resume prompt; `t=0` means "from the beginning", not "no
 * timestamp". Only the first episode of a launch gets it.
 */
export function sharedStartOverride(startSeconds: number | undefined): PlaybackStartIntent | null {
  if (startSeconds === undefined || !Number.isFinite(startSeconds) || startSeconds < 0) {
    return null;
  }
  return startAtResumePoint(startSeconds, { suppressResumePrompt: true });
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
