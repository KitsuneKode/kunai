import { applyTitleProviderPreferenceToSession } from "@/app/playback-provider-switch";
import type { Container } from "@/container";
import { createSourceSelectionEngine } from "@/domain/playback-source/SourceSelectionEngine";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
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
  const unfinished = Object.entries(entries)
    .filter(([, entry]) => !isFinished(entry))
    .sort(
      (a, b) =>
        (new Date(b[1].updatedAt).getTime() || 0) - (new Date(a[1].updatedAt).getTime() || 0),
    );
  const selected = unfinished[0];
  return selected ? { titleId: selected[0], entry: selected[1] } : null;
}

export function selectContinueHistoryEntryFromRecent(
  entries: readonly [string, HistoryProgress][],
): HistoryLaunchSelection | null {
  const unfinished = entries
    .filter(([, entry]) => !isFinished(entry))
    .sort(
      (a, b) =>
        (new Date(b[1].updatedAt).getTime() || 0) - (new Date(a[1].updatedAt).getTime() || 0),
    );
  const selected = unfinished[0];
  return selected ? { titleId: selected[0], entry: selected[1] } : null;
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
