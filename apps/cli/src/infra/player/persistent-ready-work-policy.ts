import type { PlaybackTimingMetadata } from "@/domain/types";
import { shouldApplyStartAtSeek } from "@/mpv";

export type PersistentResumeStartChoice = "resume" | "start";

export type PersistentStartSeekOptions = {
  readonly startAt?: number;
  readonly resumePromptAt?: number;
  readonly offerResumeStartChoice?: boolean;
};

export function resolvePersistentStartSeekTarget(
  options: PersistentStartSeekOptions,
  choice?: PersistentResumeStartChoice,
): number | undefined {
  const resumePromptAt = options.resumePromptAt ?? 0;
  if (options.offerResumeStartChoice && shouldApplyStartAtSeek(resumePromptAt)) {
    return choice === "resume" ? resumePromptAt : undefined;
  }
  if (typeof options.startAt === "number" && shouldApplyStartAtSeek(options.startAt)) {
    return options.startAt;
  }
  return undefined;
}

export function resolveNearEofPrefetchTriggerSeconds(
  durationSeconds: number,
  timing?: PlaybackTimingMetadata | null,
): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 60) return null;
  const fallbackTrigger = Math.max(
    0,
    Math.max(durationSeconds - 180, Math.min(durationSeconds - 60, durationSeconds * 0.9)),
  );
  const creditsStart = (timing?.credits ?? [])
    .map((segment) => segment.startMs)
    .filter((startMs): startMs is number => typeof startMs === "number" && Number.isFinite(startMs))
    .map((startMs) => startMs / 1000)
    .filter(
      (startSeconds) =>
        startSeconds > 0 &&
        startSeconds < durationSeconds &&
        startSeconds >= Math.max(durationSeconds * 0.5, durationSeconds - 600),
    )
    .sort((left, right) => right - left)[0];
  if (creditsStart === undefined) return fallbackTrigger;
  return Math.max(0, Math.min(fallbackTrigger, creditsStart - 60));
}

export function buildPersistentLoadfileCommand(
  url: string,
  startAt?: number,
): ["loadfile", string, "replace", -1, { start: string }] {
  return [
    "loadfile",
    url,
    "replace",
    -1,
    { start: shouldApplyStartAtSeek(startAt) ? String(startAt) : "0" },
  ];
}
