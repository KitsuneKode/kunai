import {
  chooseFromListShell,
  type ListShellActionContext,
  type ShellOption,
} from "@/app-shell/pickers";
import { markEntryWatched } from "@/app/history-actions";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import { mediaItemFromHistoryEntry } from "@/domain/media/media-item-adapters";
import type { QueueService } from "@/domain/queue/QueueService";
import type { SessionStateManager } from "@/domain/session/SessionStateManager";
import type { ContentType } from "@/domain/types";
import {
  formatTimestamp,
  historyContentType,
  latestHistoryByTitle,
  isFinished,
  isFinished as isProgressFinished,
} from "@/services/continuation/history-progress";
import { MediaActionRouter } from "@/services/media-actions/MediaActionRouter";
import {
  historyProgressToInput,
  type HistoryProgress,
  type HistoryRepository,
  type ReleaseProgressCacheRepository,
} from "@kunai/storage";

type HistoryAction =
  | { type: "entry"; id: string; title: string; entryType: ContentType }
  | { type: "clear-all" }
  | { type: "back" };

type ReleaseProgressCacheReader = Pick<ReleaseProgressCacheRepository, "getByTitleIds">;

function formatHistoryLabel(entry: HistoryProgress, newEpisodeCount = 0): string {
  const projected = projectWatchProgress({
    timestamp: entry.positionSeconds,
    duration: entry.durationSeconds,
    completed: entry.completed,
  });
  const progress =
    projected.percentage !== null
      ? `${projected.percentage}%`
      : formatTimestamp(entry.positionSeconds);
  if (historyContentType(entry) === "series") {
    const epLabel = `S${String(entry.season ?? 1).padStart(2, "0")}E${String(entry.episode ?? entry.absoluteEpisode ?? 1).padStart(2, "0")}`;
    const newLabel = newEpisodeCount > 0 ? `  ·  +${newEpisodeCount} new` : "";
    return `${entry.title}  ·  ${epLabel}  ·  ${progress}${newLabel}`;
  }
  return `${entry.title}  ·  movie  ·  ${progress}`;
}

export function relativeHistoryDate(isoDate: string): string {
  const ms = Date.now() - Date.parse(isoDate);
  if (!Number.isFinite(ms) || ms < 0) return new Date(isoDate).toLocaleDateString();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return new Date(isoDate).toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

function formatHistoryDetail(entry: HistoryProgress, newEpisodeCount = 0): string {
  const watched = relativeHistoryDate(entry.updatedAt);
  const finishedLabel = isFinished(entry) && newEpisodeCount === 0 ? "  ·  up to date" : "";
  return `${watched}${finishedLabel}  ·  provider ${entry.providerId ?? "unknown"}`;
}

export async function openHistoryShell(
  historyRepository: HistoryRepository,
  actionContext?: ListShellActionContext,
  releaseProgressCache?: ReleaseProgressCacheReader,
  stateManager?: SessionStateManager,
  queueService?: QueueService,
): Promise<void> {
  const mediaActions = new MediaActionRouter({
    queue: queueService
      ? {
          enqueueMediaItem: (item, options) => {
            queueService.enqueueMediaItem(item, options);
          },
        }
      : undefined,
    history: {
      markWatched: (item) => {
        const latest = historyRepository.getProgress(
          {
            id: item.titleId,
            kind: item.mediaKind === "movie" ? "movie" : "series",
            title: item.title,
          },
          item.mediaKind === "movie"
            ? undefined
            : {
                season: item.season ?? 1,
                episode: item.episode ?? item.absoluteEpisode ?? 1,
              },
        );
        if (latest) {
          historyRepository.upsertProgress(historyProgressToInput(markEntryWatched(latest)));
          return;
        }
        historyRepository.upsertProgress({
          title: {
            id: item.titleId,
            kind: item.mediaKind === "movie" ? "movie" : "series",
            title: item.title,
          },
          episode:
            item.mediaKind === "movie"
              ? undefined
              : {
                  season: item.season ?? 1,
                  episode: item.episode ?? item.absoluteEpisode ?? 1,
                },
          positionSeconds: 0,
          completed: true,
        });
      },
    },
  });

  while (true) {
    const entries = Object.entries(
      latestHistoryByTitle(historyRepository.listLatestByTitle()),
    ).sort(
      (a, b) =>
        (new Date(b[1].updatedAt).getTime() || 0) - (new Date(a[1].updatedAt).getTime() || 0),
    );

    const newEpisodeCounts = new Map<string, number>();
    const releaseProgress = releaseProgressCache?.getByTitleIds(entries.map(([id]) => id));
    if (releaseProgress) {
      for (const [id, entry] of entries) {
        if (historyContentType(entry) !== "series") continue;
        const projection = releaseProgress.get(id);
        if (!projection || projection.status !== "new-episodes") continue;
        if (projection.newEpisodeCount > 0) newEpisodeCounts.set(id, projection.newEpisodeCount);
      }
    }

    const options: ShellOption<HistoryAction>[] = [
      ...entries.map(([id, entry]) => {
        const newCount = newEpisodeCounts.get(id) ?? 0;
        return {
          value: {
            type: "entry" as const,
            id,
            title: entry.title,
            entryType: historyContentType(entry),
          },
          label: formatHistoryLabel(entry, newCount),
          detail: formatHistoryDetail(entry, newCount),
        };
      }),
      ...(entries.length > 0
        ? [
            {
              value: { type: "clear-all" as const },
              label: "Clear all history",
              detail: "Remove every saved playback position",
            },
          ]
        : []),
      { value: { type: "back" as const }, label: "Back" },
    ];

    const picked = await chooseFromListShell({
      title: "History",
      subtitle:
        entries.length > 0
          ? `${entries.length} title${entries.length === 1 ? "" : "s"} · select to view or manage`
          : "No watch history yet",
      actionContext,
      options,
    });

    if (!picked || picked.type === "back") return;

    if (picked.type === "clear-all") {
      const confirm = await chooseFromListShell({
        title: "Clear all history?",
        subtitle: "This removes every saved playback position",
        actionContext,
        options: [
          { value: true, label: "Yes, clear all history" },
          { value: false, label: "Cancel" },
        ],
      });
      if (confirm) historyRepository.clear();
      continue;
    }

    type EntryAction = "search" | "episodes" | "queue" | "mark-watched" | "remove" | "back";
    const isSeries = picked.entryType === "series";
    const pickedEntry = entries.find(([id]) => id === picked.id)?.[1];
    const lookupTitle = pickedEntry
      ? {
          id: pickedEntry.titleId,
          kind: pickedEntry.mediaKind,
          title: pickedEntry.title,
          externalIds: pickedEntry.externalIds,
        }
      : {
          id: picked.id,
          kind: picked.entryType === "movie" ? ("movie" as const) : ("series" as const),
          title: picked.title,
        };
    const subOptions: ShellOption<EntryAction>[] = [
      {
        value: "search",
        label: "Open in search",
        detail: "Pre-fill the search bar with this title",
      },
      ...(isSeries
        ? [
            {
              value: "episodes" as EntryAction,
              label: "View episode history",
              detail: "Browse per-episode progress and watch dates",
            },
          ]
        : []),
      ...(queueService
        ? [
            {
              value: "queue" as EntryAction,
              label: "Add to queue",
              detail: "Queue without starting playback now",
            },
          ]
        : []),
      {
        value: "mark-watched" as EntryAction,
        label: "Mark as watched",
        detail: "Flag the current episode finished without playing it",
      },
      {
        value: "remove" as EntryAction,
        label: "Remove from history",
        detail: "Delete the saved position for this title",
      },
      { value: "back" as EntryAction, label: "Back" },
    ];

    const action = await chooseFromListShell({
      title: picked.title,
      subtitle: formatHistoryDetail(
        historyRepository.getLatestForTitleIdentity(lookupTitle) ?? {
          key: "",
          titleId: picked.id,
          mediaKind: picked.entryType,
          title: picked.title,
          season: 1,
          episode: 1,
          positionSeconds: 0,
          durationSeconds: 0,
          completed: false,
          providerId: "",
          updatedAt: new Date(0).toISOString(),
          createdAt: new Date(0).toISOString(),
        },
        newEpisodeCounts.get(picked.id) ?? 0,
      ),
      actionContext,
      options: subOptions,
    });

    if (!action || action === "back") continue;

    if (action === "search") {
      stateManager?.dispatch({ type: "SET_SEARCH_QUERY", query: picked.title });
      return;
    }

    if (action === "episodes") {
      await openEpisodeHistoryShell(historyRepository, picked.id, picked.title, actionContext);
      continue;
    }

    if (action === "queue" && queueService) {
      const entry = historyRepository.getLatestForTitleIdentity(lookupTitle);
      const result = await mediaActions.run({
        actionId: "queue-end",
        item: entry
          ? {
              titleId: picked.id,
              title: picked.title,
              mediaKind: picked.entryType,
              season: entry.season ?? 1,
              episode:
                entry.episode !== undefined && historyContentType(entry) === "series"
                  ? entry.episode + 1
                  : undefined,
            }
          : {
              titleId: picked.id,
              title: picked.title,
              mediaKind: picked.entryType,
            },
        source: "history",
      });
      if (result.status === "unsupported") {
        stateManager?.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note: result.reason });
      }
      continue;
    }

    if (action === "mark-watched") {
      const latest = historyRepository.getLatestForTitleIdentity(lookupTitle);
      if (latest) {
        const result = await mediaActions.run({
          actionId: "mark-watched",
          item: mediaItemFromHistoryEntry(picked.id, latest),
          source: "history",
        });
        if (result.status === "unsupported") {
          stateManager?.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note: result.reason });
        } else {
          stateManager?.dispatch({
            type: "SET_PLAYBACK_FEEDBACK",
            note: `Marked ${picked.title} as watched.`,
          });
        }
      }
      continue;
    }

    if (action === "remove") {
      const confirm = await chooseFromListShell({
        title: `Remove ${picked.title}?`,
        subtitle: "This deletes the saved position for this title",
        actionContext,
        options: [
          { value: true, label: "Remove entry" },
          { value: false, label: "Keep entry" },
        ],
      });
      if (confirm) historyRepository.deleteTitle(picked.id);
    }
  }
}

async function openEpisodeHistoryShell(
  historyRepository: HistoryRepository,
  titleId: string,
  titleName: string,
  actionContext?: ListShellActionContext,
): Promise<void> {
  const allEpisodes = historyRepository.listByTitle(titleId);
  if (allEpisodes.length === 0) return;

  const sorted = [...allEpisodes].sort((a, b) => {
    const seasonA = a.season ?? Number.MAX_SAFE_INTEGER;
    const seasonB = b.season ?? Number.MAX_SAFE_INTEGER;
    if (seasonA !== seasonB) return seasonA - seasonB;
    return (a.episode ?? Number.MAX_SAFE_INTEGER) - (b.episode ?? Number.MAX_SAFE_INTEGER);
  });

  const options: ShellOption<number>[] = sorted.map((ep, i) => {
    const epCode =
      typeof ep.season === "number" && typeof ep.episode === "number"
        ? `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`
        : typeof ep.episode === "number"
          ? `Episode ${ep.episode}`
          : "Unknown episode";
    const projected = projectWatchProgress({
      timestamp: ep.positionSeconds,
      duration: ep.durationSeconds,
      completed: ep.completed,
    });
    const pct =
      projected.percentage !== null
        ? `${projected.percentage}%`
        : formatTimestamp(ep.positionSeconds);
    const statusLabel = isProgressFinished(ep) ? "✓ watched" : pct;
    const dateLabel = relativeHistoryDate(ep.updatedAt);
    return {
      value: i,
      label: epCode,
      detail: `${statusLabel} · ${dateLabel} · via ${ep.providerId ?? "unknown"}`,
    };
  });

  const finishedCount = sorted.filter(isProgressFinished).length;
  await chooseFromListShell({
    title: titleName,
    subtitle: `${sorted.length} episode${sorted.length === 1 ? "" : "s"} · ${finishedCount} watched · Esc to go back`,
    actionContext,
    options,
  });
}
