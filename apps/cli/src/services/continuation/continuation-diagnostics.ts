import type { Container } from "@/container";
import type { HistoryProgress } from "@kunai/storage";

import type { ContinueSourcePreference } from "./continuation-source";

export type ContinuationSelectionRef = {
  readonly titleId: string;
  readonly entry: HistoryProgress;
  readonly localJobId?: string;
  readonly targetEpisode?: {
    readonly season: number;
    readonly episode: number;
    readonly reason: "resume" | "new-episode" | "offline-ready";
  };
};

export type ContinuationSurface = "startup" | "history" | "calendar" | "command";

export function recordContinuationProjectDecision(
  container: Pick<Container, "diagnosticsService">,
  input: {
    readonly surface: ContinuationSurface;
    readonly titleId: string;
    readonly state: string;
    readonly actionKind?: string;
    readonly season?: number;
    readonly episode?: number;
    readonly freshness?: string;
  },
): void {
  container.diagnosticsService.record({
    category: "session",
    operation: "continuation.project",
    message: "Continuation target selected from shared decision owner",
    titleId: input.titleId,
    context: {
      surface: input.surface,
      kind: input.state,
      action: input.actionKind,
      season: input.season,
      episode: input.episode,
      freshness: input.freshness,
    },
  });
}

export function recordContinuationSourceResolution(
  container: Pick<Container, "diagnosticsService">,
  input: {
    readonly surface: ContinuationSurface;
    readonly selection: ContinuationSelectionRef;
    readonly preference: ContinueSourcePreference;
    readonly override?: "local" | "stream";
    readonly resolved: "local" | "stream";
  },
): void {
  container.diagnosticsService.record({
    category: "playback",
    operation: "continuation.source",
    message: "Continue source resolved from preference and projection",
    titleId: input.selection.titleId,
    context: {
      surface: input.surface,
      preference: input.preference,
      override: input.override ?? null,
      resolved: input.resolved,
      localJobId: input.selection.localJobId ?? null,
      targetSeason: input.selection.targetEpisode?.season ?? input.selection.entry.season ?? null,
      targetEpisode:
        input.selection.targetEpisode?.episode ??
        input.selection.entry.episode ??
        input.selection.entry.absoluteEpisode ??
        null,
      targetReason: input.selection.targetEpisode?.reason ?? null,
    },
  });
}
