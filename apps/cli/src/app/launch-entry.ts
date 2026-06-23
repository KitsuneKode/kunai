import { applyTitleProviderPreferenceToSession } from "@/app/playback-provider-switch";
import type { Container } from "@/container";
import { createSourceSelectionEngine } from "@/domain/playback-source/SourceSelectionEngine";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import type { ContinuationViewDecision } from "@/services/continuation/ContinueWatchingService";
import { historyContentType, isFinished } from "@/services/continuation/history-progress";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import type { HistoryProgress } from "@kunai/storage";

export type HistoryLaunchSelection = {
  readonly titleId: string;
  readonly entry: HistoryProgress;
  readonly targetEpisode?: {
    readonly season: number;
    readonly episode: number;
    readonly reason: "resume" | "new-episode" | "offline-ready";
  };
};

export function selectContinueHistoryEntry(
  entries: Record<string, HistoryProgress>,
): HistoryLaunchSelection | null {
  return selectNewestUnfinishedAnchor(Object.entries(entries));
}

export function selectContinueHistoryEntryFromRecent(
  entries: readonly [string, HistoryProgress][],
): HistoryLaunchSelection | null {
  return selectNewestUnfinishedAnchor(entries);
}

export function historyLaunchSelectionFromContinuation(
  decision: ContinuationViewDecision,
): HistoryLaunchSelection {
  if (!decision.target) throw new Error("Cannot launch an empty continuation decision");
  return {
    titleId: decision.target.titleId,
    entry: decision.target.sourceEntry,
    targetEpisode:
      decision.target.mediaKind === "series"
        ? {
            season: decision.target.season ?? 1,
            episode: decision.target.episode ?? 1,
            reason: continuationTargetReason(decision),
          }
        : undefined,
  };
}

function continuationTargetReason(
  decision: ContinuationViewDecision,
): NonNullable<HistoryLaunchSelection["targetEpisode"]>["reason"] {
  if (decision.primaryAction?.kind === "play-local") return "offline-ready";
  if (decision.primaryAction?.kind === "select-online") return "new-episode";
  return "resume";
}

function selectNewestUnfinishedAnchor(
  entries: readonly [string, HistoryProgress][],
): HistoryLaunchSelection | null {
  const latestByTitle = new Map<string, HistoryProgress>();
  for (const [titleId, entry] of entries) {
    const current = latestByTitle.get(titleId);
    if (!current || Date.parse(entry.updatedAt) > Date.parse(current.updatedAt)) {
      latestByTitle.set(titleId, entry);
    }
  }

  for (const [titleId, entry] of [...latestByTitle.entries()].sort(
    ([, left], [, right]) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0),
  )) {
    if (!isFinished(entry)) return { titleId, entry };
  }
  return null;
}

export function titleFromHistorySelection(selection: HistoryLaunchSelection): TitleInfo {
  return {
    id: selection.titleId,
    type: historyContentType(selection.entry),
    name: selection.entry.title,
    // Restore the stored poster so resumed playback renders art (it was simply
    // absent because history never persisted a poster URL).
    posterUrl: selection.entry.posterUrl,
    externalIds: selection.entry.externalIds,
  };
}

export function episodeFromHistorySelection(
  selection: HistoryLaunchSelection,
): EpisodeInfo | undefined {
  if (historyContentType(selection.entry) !== "series") return undefined;
  const target = selection.targetEpisode ?? {
    season: selection.entry.season ?? 1,
    episode: selection.entry.episode ?? selection.entry.absoluteEpisode ?? 1,
  };
  return { season: target.season, episode: target.episode };
}

export function selectLocalContinueCandidate(
  selection: HistoryLaunchSelection,
  entries: readonly OfflineLibraryEntry[],
): OfflineLibraryEntry | null {
  return (
    entries.find((entry) => {
      if (entry.status !== "ready") return false;
      if (entry.job.titleId !== selection.titleId) return false;
      if (historyContentType(selection.entry) === "movie") return entry.job.mediaKind === "movie";
      const target = selection.targetEpisode ?? {
        season: selection.entry.season ?? 1,
        episode: selection.entry.episode ?? selection.entry.absoluteEpisode ?? 1,
      };
      return (
        entry.job.mediaKind !== "movie" &&
        entry.job.season === target.season &&
        entry.job.episode === target.episode
      );
    }) ?? null
  );
}

export async function recordLocalHistorySourceDecision(
  container: Pick<Container, "offlineLibraryService" | "diagnosticsService" | "stateManager">,
  selection: HistoryLaunchSelection,
  reason: "continue" | "history",
): Promise<void> {
  const localCandidate = selectLocalContinueCandidate(
    selection,
    await container.offlineLibraryService.listCompletedEntries(120).catch(() => []),
  );
  if (!localCandidate) return;

  const decision = createSourceSelectionEngine().decide({
    entrypoint: "continue",
    local: { status: "ready", jobId: localCandidate.job.id },
    networkAvailable: true,
    preference: "ask",
  });
  container.diagnosticsService.record({
    category: "playback",
    message: "History target has an exact ready local artifact",
    context: {
      reason,
      titleId: selection.titleId,
      titleName: selection.entry.title,
      season: selection.entry.season ?? 1,
      episode: selection.entry.episode ?? selection.entry.absoluteEpisode ?? 1,
      jobId: localCandidate.job.id,
      outputPath: localCandidate.job.outputPath,
      sourceDecision: decision.reason,
      shouldResolveOnline: decision.shouldResolveOnline,
    },
  });
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note:
      reason === "continue"
        ? "Downloaded copy is ready for this episode. Use /offline for local playback, or continue online from history."
        : "Downloaded copy is ready for this history item. Use /offline for local playback, or continue online.",
  });
}

export function applyHistorySelectionProvider(
  container: Pick<Container, "config" | "providerRegistry" | "stateManager">,
  selection: HistoryLaunchSelection,
): void {
  const titleId = selection.titleId;
  const appliedPreference = applyTitleProviderPreferenceToSession(container, titleId);
  if (!appliedPreference) {
    const state = container.stateManager.getState();
    const keepSessionProvider = state.providerSwitchSeq > 0;
    if (!keepSessionProvider) {
      const provider = container.providerRegistry.get(selection.entry.providerId ?? "unknown");
      if (provider) {
        container.stateManager.dispatch({
          type: "SET_MODE",
          mode: provider.metadata.isAnimeProvider ? "anime" : "series",
          provider: provider.metadata.id,
        });
      } else {
        container.stateManager.dispatch({
          type: "SET_PROVIDER",
          provider: selection.entry.providerId ?? "unknown",
        });
      }
    }
  }
  if (historyContentType(selection.entry) !== "series") return;
  const episode = episodeFromHistorySelection(selection);
  if (!episode) return;
  container.stateManager.dispatch({
    type: "SELECT_EPISODE",
    episode,
  });
}
