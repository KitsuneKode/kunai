import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  chooseEpisodeFromOptions,
  chooseFromListShell,
  chooseSeasonFromOptions,
  type ListShellActionContext,
  type ShellOption,
} from "@/app-shell/pickers";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import { runAutoplayAdvanceCountdown } from "@/app/autoplay-advance-countdown";
import { chooseSearchResultTitle } from "@/app/browse-option-mappers";
import { describeKunaiHandoffLaunch, type KunaiHandoffLaunch } from "@/app/handoff-url";
import { markEntryWatched } from "@/app/history-actions";
import { buildStreamInventoryView } from "@/app/source-quality";
import { titleInfoFromSearchResult } from "@/app/title-info";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";
import { createContinuationEngine } from "@/domain/continuation/ContinuationEngine";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import { createSourceSelectionEngine } from "@/domain/playback-source/SourceSelectionEngine";
import type { LocalSourceStatus } from "@/domain/playback-source/SourceSelectionEngine";
import {
  annotateCurrentTrackFailure,
  buildTrackCapabilities,
  decodeTrackSelection,
  type DecodedTrackSelection,
  type TrackCapabilitySection,
} from "@/domain/playback/track-capabilities";
import type {
  EpisodeInfo as PlaybackEpisodeInfo,
  EpisodePickerOption,
  StreamInfo,
  TitleInfo,
} from "@/domain/types";
import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { copyToClipboard, readClipboard } from "@/infra/clipboard";
import { revealPathInOsFileManager } from "@/infra/os/reveal-in-file-manager";
import { decodeShareCode, encodeShareCode } from "@/domain/share/share-code";
import {
  historyContentType,
  isFinished as isProgressFinished,
} from "@/services/continuation/history-progress";
import { buildIssueReportDraft } from "@/services/diagnostics/IssueReportBuilder";
import { pruneOldDiagnosticFiles } from "@/services/diagnostics/retention";
import {
  getRuntimeMemoryLine,
  getRuntimeMemorySamples,
  summarizeRuntimeMemoryTrend,
} from "@/services/diagnostics/runtime-memory";
import {
  parseOfflineTitleCleanupPreference,
  type OfflineTitleCleanupPreference,
} from "@/services/download/download-cleanup-policy";
import { DownloadEnqueueRejectedError } from "@/services/download/DownloadService";
import {
  formatOfflineHistoryProgress,
  offlineResumeSecondsForJob,
} from "@/services/offline/offline-history-progress";
import {
  formatOfflineJobListingTitle,
  formatOfflineShelfBadge,
  formatOfflineShelfDetail,
  formatOfflineSecondaryLine,
  offlineStatusIcon,
  resolveOfflineArtifactStatus,
  resolveOfflineJobPreviewImage,
} from "@/services/offline/offline-library";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  formatTimestamp,
  isFinished,
  type HistoryStore,
} from "@/services/persistence/HistoryStore";
import { buildPlaybackSourceInventoryDiagnosticsSummary } from "@/services/playback/PlaybackSourceInventoryProjection";
import type { KunaiPlaylistDocument } from "@/services/playlists/KunaiPlaylistFormat";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { fetchEpisodes, fetchSeasonSummaries, type EpisodeInfo } from "@/tmdb";
import {
  getKunaiPaths,
  historyProgressToInput,
  type DownloadJobRecord,
  type HistoryProgress,
  type HistoryRepository,
  type ReleaseProgressCacheRepository,
} from "@kunai/storage";

import { resolveCommands } from "./commands";
import { buildDiagnosticsPanelLines } from "./panel-data";
import { createSessionPickerId, openSessionPicker, waitForSessionPicker } from "./session-picker";
import { runSetupFlow } from "./setup-shell";
import type { ShellAction } from "./types";

export function localSourceStatusFromArtifactStatus(status: string): LocalSourceStatus {
  if (status === "ready") return "ready";
  if (status === "missing") return "missing-file";
  if (status === "invalid-file") return "invalid-file";
  return "none";
}

export async function playCompletedDownload(container: Container, jobId: string): Promise<void> {
  let currentJobId: string | undefined = jobId;
  let isFirstEpisode = true;
  try {
    while (currentJobId) {
      const playable = await container.offlineLibraryService.getPlayableSource(currentJobId);
      if (playable.status !== "ready") {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Offline file unavailable: ${playable.status}. Check integrity first.`,
        });
        return;
      }
      const decision = createSourceSelectionEngine().decide({
        entrypoint: "offline-library",
        local: { status: "ready", jobId: currentJobId },
        networkAvailable: true,
        preference: "prefer-local",
      });
      container.diagnosticsService.record({
        category: "playback",
        message: "Offline source selected (unified play)",
        context: {
          jobId: currentJobId,
          sourceDecision: decision.reason,
          shouldResolveOnline: decision.shouldResolveOnline,
        },
      });
      const resumeSeconds = isFirstEpisode
        ? offlineResumeSecondsForJob(
            playable.job,
            container.historyRepository.listByTitle(playable.source.titleId),
          )
        : 0;
      const episodeSuffix =
        playable.source.season !== null &&
        playable.source.season !== undefined &&
        playable.source.episode !== null &&
        playable.source.episode !== undefined
          ? ` · S${String(playable.source.season).padStart(2, "0")}E${String(playable.source.episode).padStart(2, "0")}`
          : "";
      const offlineDisplayTitle = `${playable.source.titleName}${episodeSuffix}`;
      const localStream: StreamInfo = {
        url: playable.source.filePath,
        headers: {},
        subtitle: playable.source.subtitlePath ?? undefined,
        title: offlineDisplayTitle,
        timestamp: Date.now(),
      };
      // Route offline through the SAME persistent play() path online uses, so it
      // inherits the resume OFFER (resumePromptAt + resumeStartChoicePrompt), the
      // autoskip prompts, and track control — not a forced seek.
      const result = await container.player.play(localStream, {
        url: playable.source.filePath,
        displayTitle: offlineDisplayTitle,
        playbackMode: "autoplay-chain",
        resumePromptAt: resumeSeconds,
        resumeStartChoicePrompt: container.config.resumeStartChoicePrompt,
        timing: playable.source.timing ?? null,
        autoSkipEnabled: !container.stateManager.getState().autoskipSessionPaused,
        skipRecap: container.config.skipRecap,
        skipIntro: container.config.skipIntro,
        skipPreview: container.config.skipPreview,
        skipCredits: container.config.skipCredits,
      });
      const persisted = await container.offlineLibraryService.savePlaybackHistory(
        playable.source,
        result,
      );
      if (persisted) {
        container.offlineRunwayService.enqueueEvaluation(
          playable.source.titleId,
          "offline-playback-complete",
        );
      }

      // Offline autoplay: continue into the next downloaded episode, mirroring the
      // online autoNext flow (same cancelable countdown). Honors a user pause and
      // stop-after-current, and only on a natural end — so it feels like online.
      isFirstEpisode = false;
      currentJobId = undefined;
      const state = container.stateManager.getState();
      if (
        result.endReason === "eof" &&
        container.config.autoNext &&
        !state.autoplaySessionPaused &&
        !state.stopAfterCurrent
      ) {
        const nextJobId = findNextDownloadedJobId(container, playable.source);
        if (nextJobId) {
          const outcome = await runAutoplayAdvanceCountdown({
            seconds: 5,
            sleep: (ms) => Bun.sleep(ms),
            onTick: (remaining) =>
              container.stateManager.dispatch({
                type: "SET_PLAYBACK_FEEDBACK",
                note: `Up next (offline) in ${remaining}s · a to pause`,
              }),
            isCancelled: () => container.stateManager.getState().autoplaySessionPaused,
          });
          if (outcome === "cancelled") {
            container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note: null });
          } else {
            currentJobId = nextJobId;
          }
        }
      }
    }
  } finally {
    // Release the persistent mpv session when the offline run ends (no-op if none).
    await container.player.releasePersistentSession();
  }
}

/** Next downloaded episode of the same title (same season, episode + 1), or undefined. */
function findNextDownloadedJobId(
  container: Container,
  source: { readonly titleId: string; readonly season?: number; readonly episode?: number },
): string | undefined {
  if (typeof source.season !== "number" || typeof source.episode !== "number") return undefined;
  const nextEpisode = source.episode + 1;
  const next = container.offlineAssetService
    .listTitleAssets(source.titleId)
    .find(
      (asset) =>
        asset.state === "ready" && asset.season === source.season && asset.episode === nextEpisode,
    );
  return next?.originJobId;
}

export function waitForOverlayClose(
  stateManager: import("@/domain/session/SessionStateManager").SessionStateManager,
  overlayType: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const unsubscribe = stateManager.subscribe((state) => {
      const top = state.activeModals.at(-1);
      if (!top || top.type !== overlayType) {
        unsubscribe();
        resolve();
      }
    });
  });
}

type HistoryAction =
  | { type: "entry"; id: string; title: string; entryType: import("@/domain/types").ContentType }
  | { type: "clear-all" }
  | { type: "back" };

type DownloadJobAction =
  | { type: "job"; id: string }
  | { type: "check-integrity" }
  | { type: "repair-missing" }
  | { type: "download-more" }
  | { type: "search-online" }
  | { type: "protect-group" }
  | { type: "unprotect-group" }
  | { type: "toggle-continuation" }
  | { type: "edit-cleanup" }
  | { type: "delete-group" }
  | { type: "back" };
type OfflineLibraryGroupAction =
  | { type: "group"; key: string }
  | { type: "downloads" }
  | { type: "online" }
  | { type: "back" };
type CompletedDownloadAction =
  | "play"
  | "reveal"
  | "check-integrity"
  | "retry"
  | "delete-job"
  | "delete-artifact"
  | "back";

type ReleaseProgressCacheReader = Pick<ReleaseProgressCacheRepository, "getByTitleIds">;

export type SetupWizardResult = "completed" | "cancelled" | "skipped";

export async function confirmProtocolHandoff(handoff: KunaiHandoffLaunch): Promise<boolean> {
  const choice = await chooseFromListShell({
    title: "Open Kunai Link",
    subtitle: describeKunaiHandoffLaunch(handoff),
    options: [
      {
        value: "continue" as const,
        label: "Continue",
        detail: "Run this local Kunai action",
      },
      {
        value: "cancel" as const,
        label: "Cancel",
        detail: "Ignore the external link and close",
      },
    ],
  });

  return choice === "continue";
}

const SUBTITLE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "interactive", label: "Pick interactively" },
  { value: "none", label: "None" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ja", label: "Japanese" },
] as const;

const AUDIO_OPTIONS = [
  { value: "original", label: "Original", detail: "Prefer original/native audio" },
  { value: "en", label: "English", detail: "Prefer English audio when available" },
  { value: "ja", label: "Japanese", detail: "Prefer Japanese audio when available" },
  { value: "dub", label: "Dub", detail: "Prefer dubbed audio when available" },
] as const;

const QUALITY_OPTIONS = [
  {
    value: "best",
    label: "Best available",
    detail: "Let the provider choose the strongest stream",
  },
  { value: "1080p", label: "1080p", detail: "Prefer Full HD when the provider exposes variants" },
  { value: "720p", label: "720p", detail: "Prefer HD when available" },
  { value: "480p", label: "480p", detail: "Prefer lighter streams on limited networks" },
] as const;

export async function runSetupWizard({
  container,
  force = false,
}: {
  container: Container;
  force?: boolean;
}): Promise<SetupWizardResult> {
  const current = container.config.getRaw();
  const needsOnboarding = current.onboardingVersion < 2 || !current.downloadOnboardingDismissed;
  if (!force && !needsOnboarding) {
    return "skipped";
  }

  const snapshot = container.capabilitySnapshot ?? {
    mpv: Boolean(Bun.which("mpv")),
    ffprobe: Boolean(Bun.which("ffprobe")),
    ytDlp: Boolean(Bun.which("yt-dlp")),
    chafa: Boolean(Bun.which("chafa")),
    magick: Boolean(Bun.which("magick")),
    image: {
      renderer: "none",
      terminal: "unknown",
      available: false,
    } as import("@/image").ImageCapability,
    issues: [],
  };

  const defaultDownloadPath = join(dirname(getKunaiPaths().dataDbPath), "downloads");
  const { result } = runSetupFlow(snapshot);
  const { outcome, prefs } = await result;

  if (outcome === "skipped") {
    // Only mark done — never clobber existing preferences when the user skips.
    await container.config.update({
      onboardingVersion: 2,
      downloadOnboardingDismissed: true,
    });
    await container.config.save();
  } else {
    const downloadsEnabled = prefs.downloadsEnabled;
    const downloadPath = downloadsEnabled
      ? current.downloadPath || defaultDownloadPath
      : current.downloadPath;

    await container.config.update({
      onboardingVersion: 2,
      downloadOnboardingDismissed: true,
      downloadsEnabled,
      downloadPath,
      animeLanguageProfile: {
        ...current.animeLanguageProfile,
        audio: prefs.audio,
        subtitle: prefs.subtitle,
      },
      seriesLanguageProfile: {
        ...current.seriesLanguageProfile,
        subtitle: prefs.subtitle,
      },
      movieLanguageProfile: {
        ...current.movieLanguageProfile,
        subtitle: prefs.subtitle,
      },
    });
    await container.config.save();
  }

  container.diagnosticsService.record({
    category: "session",
    message: outcome === "completed" ? "Setup wizard completed" : "Setup wizard skipped",
    context: { outcome, force },
  });

  return outcome === "completed" ? "completed" : "skipped";
}

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

function relativeHistoryDate(isoDate: string): string {
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

function describeDownloadJob(job: DownloadJobRecord): string {
  return formatOfflineJobListingTitle(job);
}

async function openHistoryShell(
  historyStore: HistoryStore,
  historyRepository: HistoryRepository | undefined,
  actionContext?: ListShellActionContext,
  releaseProgressCache?: ReleaseProgressCacheReader,
  stateManager?: import("@/domain/session/SessionStateManager").SessionStateManager,
  queueService?: import("@/domain/queue/QueueService").QueueService,
): Promise<void> {
  while (true) {
    const entries = Object.entries(await historyStore.getAll()).sort(
      (a, b) =>
        (new Date(b[1].updatedAt).getTime() || 0) - (new Date(a[1].updatedAt).getTime() || 0),
    );

    // Build new-episode counts from the local reconciliation cache only.
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
      if (confirm) await historyStore.clear();
      continue;
    }

    // Title selected — show action sub-menu
    type EntryAction = "search" | "episodes" | "queue" | "mark-watched" | "remove" | "back";
    const isSeries = picked.entryType === "series";
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
              label: "Add to playlist queue",
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
        // Re-fetch latest entry for the subtitle
        (await historyStore.get(picked.id)) ?? {
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
      await openEpisodeHistoryShell(historyStore, picked.id, picked.title, actionContext);
      continue;
    }

    if (action === "queue" && queueService) {
      const entry = await historyStore.get(picked.id);
      queueService.enqueueMediaItem(
        {
          titleId: picked.id,
          title: picked.title,
          mediaKind: picked.entryType,
          season: entry ? (entry.season ?? 1) : undefined,
          episode:
            entry?.episode !== undefined && historyContentType(entry) === "series"
              ? entry.episode + 1
              : undefined,
        },
        { placement: "end", source: "history" },
      );
      continue;
    }

    if (action === "mark-watched") {
      const latest = await historyStore.get(picked.id);
      if (latest && historyRepository) {
        historyRepository.upsertProgress(historyProgressToInput(markEntryWatched(latest)));
        stateManager?.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Marked ${picked.title} as watched.`,
        });
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
      if (confirm) await historyStore.delete(picked.id);
    }
  }
}

async function openEpisodeHistoryShell(
  historyStore: HistoryStore,
  titleId: string,
  titleName: string,
  actionContext?: ListShellActionContext,
): Promise<void> {
  const allEpisodes = await historyStore.listByTitle(titleId);
  if (allEpisodes.length === 0) return;

  // Natural season → episode order (not download time) so the list reads like a
  // season, top to bottom.
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
    const statusLabel = isFinished(ep) ? "✓ watched" : pct;
    const dateLabel = relativeHistoryDate(ep.updatedAt);
    return {
      value: i,
      label: epCode,
      detail: `${statusLabel} · ${dateLabel} · via ${ep.providerId ?? "unknown"}`,
    };
  });

  const finishedCount = sorted.filter(isFinished).length;
  await chooseFromListShell({
    title: titleName,
    subtitle: `${sorted.length} episode${sorted.length === 1 ? "" : "s"} · ${finishedCount} watched · Esc to go back`,
    actionContext,
    options,
  });
}

export async function openCompletedDownloadsPicker(
  container: Container,
  actionContext?: ListShellActionContext,
): Promise<void> {
  while (true) {
    const completed = await container.offlineLibraryService.listCompletedEntries(60);
    const shelf = createOfflineLibraryEngine().buildShelf(completed);
    const options: ShellOption<OfflineLibraryGroupAction>[] = [
      ...shelf.groups.map((group) => ({
        value: { type: "group" as const, key: group.key },
        label: group.label,
        detail: [group.actionSummary, group.artifactSummary, group.detail]
          .filter(Boolean)
          .join(" · "),
        previewImageUrl: group.previewImageUrl,
      })),
      {
        value: { type: "downloads" as const },
        label: "Open download queue",
        detail: "Retry, delete, or inspect queued and failed offline jobs",
      },
      {
        value: { type: "online" as const },
        label: "Search online instead",
        detail: "Leave offline intentionally and go back to search",
      },
      { value: { type: "back" as const }, label: "Back" },
    ];
    const picked = await chooseFromListShell({
      title: "Offline library",
      subtitle:
        completed.length > 0
          ? `${shelf.summary} · choose a title`
          : `${shelf.summary}. Use /downloads to manage the queue.`,
      actionContext,
      options,
    });
    if (!picked || picked.type === "back") return;
    if (picked.type === "downloads") {
      container.stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: { type: "downloads" } });
      return;
    }
    if (picked.type === "online") {
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: "Offline library closed. Search online when you are ready.",
      });
      return;
    }
    const group = shelf.groups.find((candidate) => candidate.key === picked.key);
    if (!group) continue;
    const entryById = new Map(completed.map((entry) => [entry.job.id, entry]));
    const entries = group.entries
      .map((entry) => entryById.get(entry.jobId))
      .filter((entry): entry is (typeof completed)[number] => Boolean(entry));
    await openOfflineLibraryGroupPicker(container, entries, actionContext, {
      actionSummary: group.actionSummary,
      artifactSummary: group.artifactSummary,
    });
  }
}

export async function openOfflineLibraryGroupPicker(
  container: Container,
  entries: readonly import("@/services/offline/offline-library").OfflineLibraryEntry[],
  actionContext?: ListShellActionContext,
  groupSummary?: { readonly actionSummary: string; readonly artifactSummary: string },
): Promise<void> {
  while (true) {
    const first = entries[0]?.job;
    if (!first) return;
    const historyEntries = container.historyRepository.listByTitle(first.titleId);
    const offlinePolicy = container.offlineTitlePolicies.get(first.titleId);
    const continuation = createContinuationEngine().decide({
      titleName: first.titleName,
      networkAvailable: true,
      localEpisodes: entries
        .filter((entry) => entry.job.season !== undefined && entry.job.episode !== undefined)
        .map((entry) => ({
          season: entry.job.season ?? 1,
          episode: entry.job.episode ?? 1,
          playable: entry.status === "ready",
          completed: historyEntries.some(
            (history) =>
              (history.season ?? 1) === entry.job.season &&
              (history.episode ?? history.absoluteEpisode) === entry.job.episode &&
              isProgressFinished(history),
          ),
        })),
    });
    const options: ShellOption<DownloadJobAction>[] = [
      ...entries.map((entry) => ({
        value: { type: "job" as const, id: entry.job.id },
        label: `${offlineStatusIcon(entry.status)} ${formatOfflineJobListingTitle(entry.job)}`,
        detail: [
          formatOfflineShelfBadge(entry.job, entry.status),
          formatOfflineHistoryProgress(entry.job, historyEntries),
          formatOfflineShelfDetail(entry.job, entry.status),
        ]
          .filter(Boolean)
          .join("  ·  "),
        previewImageUrl: resolveOfflineJobPreviewImage(entry.job),
      })),
      ...buildOfflineGroupActions(
        entries,
        container.config.protectedDownloadJobIds,
        offlinePolicy?.enrolled === true,
        parseOfflineTitleCleanupPreference(offlinePolicy?.cleanupJson),
      ),
      { value: { type: "back" as const }, label: "Back to titles" },
    ];
    const picked = await chooseFromListShell({
      title: first.titleName,
      subtitle: [
        groupSummary?.actionSummary ?? `${entries.length} local item(s)`,
        groupSummary?.artifactSummary,
        continuation.note,
        "play, reveal folder, re-download, delete",
      ]
        .filter(Boolean)
        .join(" · "),
      actionContext,
      options,
    });
    if (!picked || picked.type === "back") return;
    if (picked.type === "check-integrity") {
      const statuses = await Promise.all(
        entries.map(async (entry) => ({
          job: entry.job,
          status: await resolveOfflineArtifactStatus(entry.job),
        })),
      );
      const issueCount = statuses.filter((entry) => entry.status !== "ready").length;
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          issueCount === 0
            ? `Integrity check passed for ${entries.length} local item(s).`
            : `Integrity check found ${issueCount} item(s) needing repair.`,
      });
      container.diagnosticsService.record({
        category: "download",
        message: "Offline group integrity checked",
        context: {
          titleId: first.titleId,
          total: entries.length,
          issueCount,
          statuses: statuses.map((entry) => ({
            jobId: entry.job.id,
            status: entry.status,
            outputPath: entry.job.outputPath,
          })),
        },
      });
      continue;
    }
    if (picked.type === "repair-missing") {
      const repairEntries = entries.filter((entry) => entry.status !== "ready");
      for (const entry of repairEntries) {
        container.downloadService.retry(entry.job.id);
      }
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Re-download queued for ${repairEntries.length} missing ${
          repairEntries.length === 1 ? "item" : "items"
        }`,
      });
      void container.downloadService.processQueue();
      continue;
    }
    if (picked.type === "download-more") {
      await queueMoreOfflineTitleEpisodes(container, first, actionContext);
      continue;
    }
    if (picked.type === "toggle-continuation") {
      const enrolling = offlinePolicy?.enrolled !== true;
      container.offlineTitlePolicies.upsert({
        titleId: first.titleId,
        mediaKind: first.mediaKind,
        titleName: first.titleName,
        enrolled: enrolling,
        runwayTarget: container.config.offlineDefaultRunwayTarget,
        profileJson: JSON.stringify({
          audio: first.animeLang ?? "original",
          subtitle: first.subLang ?? "none",
          quality: first.selectedQualityLabel ?? "best",
        }),
        cleanupJson:
          offlinePolicy?.cleanupJson ?? JSON.stringify({ mode: "keep-last-watched", count: 1 }),
        updatedAt: new Date().toISOString(),
      });
      if (enrolling) {
        container.offlineRunwayService.enqueueEvaluation(first.titleId, "policy-change");
      }
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: enrolling
          ? `Keeping ${first.titleName} ready offline within your runway limit.`
          : `Stopped offline continuation for ${first.titleName}. Existing files stay local.`,
      });
      continue;
    }
    if (picked.type === "edit-cleanup") {
      const policy = await chooseFromListShell<OfflineTitleCleanupPreference>({
        title: `After watching ${first.titleName}`,
        subtitle:
          "Controls cleanup suggestions only; local files stay until you explicitly delete them",
        actionContext,
        options: [
          {
            value: { mode: "keep-last-watched", count: 1 },
            label: "Keep latest watched episode",
            detail: "Keep one watched local fallback and suggest older watched files",
          },
          {
            value: { mode: "cleanup-watched", graceDays: container.config.autoCleanupGraceDays },
            label: `Suggest cleanup after ${container.config.autoCleanupGraceDays} days`,
            detail: "Uses your cleanup grace window when cleanup suggestions are enabled",
          },
        ],
      });
      if (!policy) continue;
      container.offlineTitlePolicies.upsert({
        titleId: first.titleId,
        mediaKind: first.mediaKind,
        titleName: first.titleName,
        enrolled: offlinePolicy?.enrolled === true,
        runwayTarget: offlinePolicy?.runwayTarget ?? container.config.offlineDefaultRunwayTarget,
        profileJson:
          offlinePolicy?.profileJson ??
          JSON.stringify({
            audio: first.animeLang ?? "original",
            subtitle: first.subLang ?? "none",
            quality: first.selectedQualityLabel ?? "best",
          }),
        cleanupJson: JSON.stringify(policy),
        updatedAt: new Date().toISOString(),
      });
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          policy.mode === "keep-last-watched"
            ? `Keeping one watched local episode for ${first.titleName}.`
            : `Cleanup suggestions for ${first.titleName} use a ${policy.graceDays}-day grace.`,
      });
      continue;
    }
    if (picked.type === "search-online") {
      container.stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: first.titleName });
      container.stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Search prepared for ${first.titleName}. Submit it to continue online.`,
      });
      container.diagnosticsService.record({
        category: "search",
        message: "Offline title requested online continuation",
        context: {
          titleId: first.titleId,
          titleName: first.titleName,
          provider: first.providerId,
        },
      });
      return;
    }
    if (picked.type === "protect-group" || picked.type === "unprotect-group") {
      await setOfflineGroupProtection(
        container,
        entries.map((entry) => entry.job.id),
        picked.type === "protect-group",
      );
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          picked.type === "protect-group"
            ? `Protected ${first.titleName} from watched-download cleanup.`
            : `Removed cleanup protection for ${first.titleName}.`,
      });
      continue;
    }
    if (picked.type === "delete-group") {
      const confirmed = await chooseFromListShell<boolean>({
        title: `Delete ${first.titleName}?`,
        subtitle: `Remove ${entries.length} local ${
          entries.length === 1 ? "item" : "items"
        }, subtitles, and queue records for this title.`,
        actionContext,
        options: [
          { value: false, label: "Keep title", detail: "Go back without deleting anything" },
          {
            value: true,
            label: "Delete local title",
            detail: "Remove all local files and download records in this group",
          },
        ],
      });
      if (!confirmed) continue;
      await Promise.all(
        entries.map((entry) =>
          container.downloadService.deleteJob(entry.job.id, { deleteArtifact: true }),
        ),
      );
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Deleted offline title: ${first.titleName}`,
      });
      return;
    }
    const job = container.downloadService.getJob(picked.id);
    if (!job || (job.status !== "completed" && job.status !== "completed-with-notes")) continue;

    const playable = await container.offlineLibraryService.getPlayableSource(job.id);
    const artifactStatus = playable.status === "ready" ? "ready" : playable.status;
    const artifactLineStatus =
      artifactStatus === "invalid-file" ||
      artifactStatus === "missing" ||
      artifactStatus === "ready"
        ? artifactStatus
        : "missing";
    const action = await chooseFromListShell<CompletedDownloadAction>({
      title: describeDownloadJob(job),
      subtitle: `${formatOfflineSecondaryLine(job, artifactLineStatus)}  ·  ${job.outputPath}`,
      actionContext,
      options: [
        {
          value: "play",
          label: artifactStatus === "ready" ? "Play downloaded file" : "Play unavailable",
          detail: artifactStatus === "ready" ? "Open local artifact in mpv" : artifactStatus,
          previewImageUrl: resolveOfflineJobPreviewImage(job),
        },
        {
          value: "check-integrity",
          label: "Check integrity",
          detail: "Verify the local media artifact is readable before playback",
          previewImageUrl: resolveOfflineJobPreviewImage(job),
        },
        { value: "reveal", label: "Reveal folder", detail: dirname(job.outputPath) },
        {
          value: "retry",
          label: job.status === "completed-with-notes" ? "Repair sidecars" : "Re-download",
          detail:
            job.status === "completed-with-notes"
              ? "Retry optional subtitle or artwork sidecars without replacing the video"
              : "Queue a fresh attempt from stored download intent",
        },
        {
          value: "delete-artifact",
          label: "Delete local file and job",
          detail: "Remove local media, subtitle file, and queue record",
        },
        {
          value: "delete-job",
          label: "Delete job only",
          detail: "Keep local files on disk but remove this queue record",
        },
        { value: "back", label: "Back" },
      ],
    });
    if (!action || action === "back") continue;
    if (action === "play") {
      if (playable.status !== "ready") {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Offline file unavailable: ${artifactStatus}. Check integrity first.`,
        });
        container.diagnosticsService.record({
          category: "download",
          message: "Completed download playback blocked",
          context: {
            jobId: job.id,
            artifactStatus,
            outputPath: job.outputPath,
          },
        });
        continue;
      }
      await playCompletedDownload(container, job.id);
      continue;
    }
    if (action === "reveal") {
      const reveal = await revealPathInOsFileManager(job.outputPath);
      if (!reveal.ok) {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Could not open folder: ${reveal.stderr ?? "system helper failed"}`,
        });
      }
      continue;
    }
    if (action === "check-integrity") {
      const checkedStatus = await resolveOfflineArtifactStatus(job);
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          checkedStatus === "ready"
            ? `Integrity check passed: ${formatOfflineJobListingTitle(job)}`
            : `Integrity check failed: ${formatOfflineJobListingTitle(job)} is ${checkedStatus}`,
      });
      container.diagnosticsService.record({
        category: "download",
        message: "Offline artifact integrity checked",
        context: { jobId: job.id, artifactStatus: checkedStatus, outputPath: job.outputPath },
      });
      continue;
    }
    if (action === "retry") {
      await container.downloadService.retry(job.id);
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          job.status === "completed-with-notes"
            ? `Sidecar repair checked: ${formatOfflineJobListingTitle(job)}`
            : `Re-download queued: ${formatOfflineJobListingTitle(job)}`,
      });
      void container.downloadService.processQueue();
      continue;
    }
    await container.downloadService.deleteJob(job.id, {
      deleteArtifact: action === "delete-artifact",
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: action === "delete-artifact" ? "Download artifact deleted" : "Download job deleted",
    });
  }
}

function buildOfflineGroupActions(
  entries: readonly import("@/services/offline/offline-library").OfflineLibraryEntry[],
  protectedJobIds: readonly string[] = [],
  continuationEnrolled = false,
  cleanupPreference?: OfflineTitleCleanupPreference,
): ShellOption<DownloadJobAction>[] {
  const missingCount = entries.filter((entry) => entry.status !== "ready").length;
  const protectedSet = new Set(protectedJobIds);
  const allProtected =
    entries.length > 0 && entries.every((entry) => protectedSet.has(entry.job.id));
  const actions: ShellOption<DownloadJobAction>[] = [
    {
      value: { type: "search-online" },
      label: "Continue this title online",
      detail: "Prepare a search for this title; no provider work happens until you submit it",
    },
    {
      value: { type: "download-more" },
      label: "Download more episodes",
      detail: "Open the download episode picker for this title",
    },
    {
      value: { type: "toggle-continuation" },
      label: continuationEnrolled ? "Stop keeping offline" : "Keep watching offline",
      detail: continuationEnrolled
        ? "Stop filling future local episodes; keep files already downloaded"
        : "Keep a bounded local runway after you finish downloaded episodes",
    },
    {
      value: { type: "edit-cleanup" },
      label: "After watching",
      detail:
        cleanupPreference?.mode === "cleanup-watched"
          ? `Suggest cleanup after ${cleanupPreference.graceDays} days`
          : "Keep the latest watched local episode",
    },
    {
      value: { type: "check-integrity" },
      label: "Check title integrity",
      detail: "Verify local files and surface anything that needs repair",
    },
  ];
  if (missingCount > 0) {
    actions.push({
      value: { type: "repair-missing" },
      label: `Retry ${missingCount} missing ${missingCount === 1 ? "item" : "items"}`,
      detail: "Repair this title without opening every episode one by one",
    });
  }
  actions.push({
    value: { type: allProtected ? "unprotect-group" : "protect-group" },
    label: allProtected ? "Remove cleanup protection" : "Protect from cleanup",
    detail: allProtected
      ? "Allow watched-download cleanup suggestions for this title again"
      : "Keep this title out of watched-download cleanup suggestions",
  });
  actions.push({
    value: { type: "delete-group" },
    label: "Delete this offline title",
    detail: "Confirm before removing all local files and queue records",
  });
  return actions;
}

async function queueMoreOfflineTitleEpisodes(
  container: Container,
  first: DownloadJobRecord,
  actionContext?: ListShellActionContext,
): Promise<void> {
  const provider = container.providerRegistry.get(first.providerId);
  if (provider) {
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode: provider.metadata.isAnimeProvider ? "anime" : "series",
      provider: provider.metadata.id,
    });
  } else {
    container.stateManager.dispatch({ type: "SET_PROVIDER", provider: first.providerId });
  }

  const title: TitleInfo = {
    id: first.titleId,
    type: first.mediaKind === "movie" ? "movie" : "series",
    name: first.titleName,
    posterUrl: first.posterUrl,
  };
  const { DownloadOnlyPhase } = await import("@/app/DownloadOnlyPhase");
  const result = await new DownloadOnlyPhase().execute(
    { title },
    { container, signal: new AbortController().signal },
  );
  container.diagnosticsService.record({
    category: "download",
    message: "Offline title download-more action completed",
    context: {
      titleId: first.titleId,
      provider: first.providerId,
      result: result.status === "success" ? result.value : result.status,
      task: actionContext?.taskLabel,
    },
  });
}

async function setOfflineGroupProtection(
  container: Container,
  jobIds: readonly string[],
  protectedFromCleanup: boolean,
): Promise<void> {
  const current = new Set(container.config.protectedDownloadJobIds);
  for (const jobId of jobIds) {
    if (protectedFromCleanup) {
      current.add(jobId);
    } else {
      current.delete(jobId);
    }
  }
  await container.config.update({ protectedDownloadJobIds: [...current] });
  await container.config.save();
}

async function openStaticInfoShell({
  title,
  subtitle,
  lines,
}: {
  title: string;
  subtitle: string;
  lines: readonly { label: string; detail?: string }[];
}): Promise<void> {
  await chooseFromListShell({
    title,
    subtitle,
    options: [
      ...lines.map((line, index) => ({
        value: index,
        label: line.label,
        detail: line.detail,
      })),
      { value: -1, label: "Back" },
    ],
  });
}

async function openExternalUrl(url: string): Promise<void> {
  const commands: readonly [string, readonly string[]][] = [
    ["xdg-open", [url]],
    ["open", [url]],
    ["cmd", ["/c", "start", "", url]],
  ];
  for (const [command, args] of commands) {
    if (!Bun.which(command)) continue;
    try {
      const proc = Bun.spawn([command, ...args], { stdout: "ignore", stderr: "ignore" });
      await proc.exited;
      return;
    } catch {
      // try next opener
    }
  }
}

async function openIssueUrl(
  url = "https://github.com/kitsunekode/kunai/issues/new/choose",
): Promise<void> {
  await openExternalUrl(url);
}

async function openDocsUrl(
  url = process.env.KUNAI_DOCS_URL ?? "https://github.com/KitsuneKode/kunai/tree/main/docs",
): Promise<void> {
  await openExternalUrl(url);
}

export function buildPickerActionContext({
  container,
  taskLabel,
  footerMode = effectiveFooterHints(container),
  allowed = ["settings", "history", "diagnostics", "help", "about", "quit", "downloads", "library"],
}: {
  container: Container;
  taskLabel: string;
  footerMode?: "detailed" | "minimal";
  allowed?: readonly import("./commands").AppCommandId[];
}): ListShellActionContext {
  return {
    taskLabel,
    footerMode,
    commands: resolveCommands(container.stateManager.getState(), allowed),
    onAction: async (action) => {
      const result = await handleShellAction({ action, container });
      return typeof result === "string" ? result : "handled";
    },
  };
}

export async function applySettingsToRuntime({
  container,
  next,
  previous,
}: {
  container: Container;
  next: KitsuneConfig;
  previous?: KitsuneConfig;
}): Promise<void> {
  const { stateManager, config } = container;
  const before = previous ?? config.getRaw();

  await config.update(next);
  await config.save();

  const state = stateManager.getState();
  stateManager.dispatch({
    type: "SET_DEFAULT_PROVIDER",
    mode: "series",
    provider: next.provider,
  });
  stateManager.dispatch({
    type: "SET_DEFAULT_PROVIDER",
    mode: "anime",
    provider: next.animeProvider,
  });
  stateManager.dispatch({
    type: "UPDATE_LANGUAGE_PROFILE",
    kind: "anime",
    profile: next.animeLanguageProfile,
  });
  stateManager.dispatch({
    type: "UPDATE_LANGUAGE_PROFILE",
    kind: "series",
    profile: next.seriesLanguageProfile,
  });
  stateManager.dispatch({
    type: "UPDATE_LANGUAGE_PROFILE",
    kind: "movie",
    profile: next.movieLanguageProfile,
  });

  const currentProvider =
    state.mode === "anime" ? state.defaultProviders.anime : state.defaultProviders.series;
  const nextDefault = state.mode === "anime" ? next.animeProvider : next.provider;
  if (state.provider === currentProvider && state.provider !== nextDefault) {
    stateManager.dispatch({
      type: "SET_PROVIDER",
      provider: nextDefault,
    });
  }

  if (state.mode === before.defaultMode && state.mode !== next.defaultMode) {
    stateManager.dispatch({
      type: "SET_MODE",
      mode: next.defaultMode,
      provider: next.defaultMode === "anime" ? next.animeProvider : next.provider,
    });
  }

  if (
    before.presenceProvider !== next.presenceProvider ||
    before.presenceDiscordClientId !== next.presenceDiscordClientId ||
    before.presenceDiscordOpenUrl !== next.presenceDiscordOpenUrl
  ) {
    await container.presence.disconnect("settings-changed");
  }
}

export type ShellWorkflowResult =
  | "handled"
  | "quit"
  | "unhandled"
  | { type: "history-entry"; title: TitleInfo; episode?: PlaybackEpisodeInfo };

type ActionHandler = (container: Container) => Promise<ShellWorkflowResult>;

const actionHandlers: Record<string, ActionHandler | undefined> = {
  quit: (c) => resolveQuitWithDownloadQueue(c),
  history: (c) => handleHistory(c),
  download: (c) => {
    void downloadSelectedResult(c);
    return Promise.resolve("handled");
  },
  downloads: (c) => handleLibraryOverlay(c, "queue"),
  library: (c) => handleLibraryOverlay(c, "library"),
  help: (c) => handleStaticOverlay(c, "help"),
  docs: async () => {
    await openDocsUrl();
    return "handled";
  },
  about: (c) => handleStaticOverlay(c, "about"),
  diagnostics: (c) => handleDiagnostics(c),
  provider: (c) => handleProviderPicker(c),
  settings: (c) => handleSettings(c),
  presence: (c) => handleSettings(c),
  setup: (c) => {
    void runSetupWizard({ container: c, force: true });
    return Promise.resolve("handled");
  },
  "clear-cache": (c) => handleClearCache(c),
  "clear-history": (c) => handleClearHistory(c),
  "export-diagnostics": (c) => handleExportDiagnostics(c),
  "report-issue": (c) => handleReportIssue(c),
  update: (c) => handleUpdate(c),
  "mark-anime": (c) => handleMarkKind(c, "anime"),
  "mark-series": (c) => handleMarkKind(c, "series"),
  share: (c) => handleShare(c),
  watch: (c) => handleWatch(c),
  watchlist: (c) => handleWatchlist(c),
  favorites: (c) => handleFavorites(c),
  playlist: (c) => handlePlaylist(c),
  "playlist-add": (c) => handlePlaylistAdd(c),
  stats: (c) => handleStats(c),
  sync: (c) => handleSync(c),
  "sync-connect-anilist": (c) => handleSyncConnectAniList(c),
  "sync-connect-tmdb": (c) => handleSyncConnectTmdb(c),
  "sync-disconnect": (c) => handleSyncDisconnect(c),
};

export async function handleShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<ShellWorkflowResult> {
  const handler = actionHandlers[action];
  if (handler) return handler(container);
  return "unhandled";
}

const withOverlay = async <T>(
  stateManager: import("@/domain/session/SessionStateManager").SessionStateManager,
  overlay: import("@/domain/session/SessionState").OverlayState,
  run: () => Promise<T>,
): Promise<T> => {
  stateManager.dispatch({ type: "OPEN_OVERLAY", overlay });
  try {
    return await run();
  } finally {
    stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
  }
};

async function handleHistory(container: Container): Promise<"handled"> {
  const { stateManager, historyStore, historyRepository, releaseProgressCache, queueService } =
    container;
  void historyStore.getAll().then((history) => {
    enqueueReleaseReconciliation(container, Object.values(history), "history");
    return undefined;
  });
  await withOverlay(stateManager, { type: "history" }, () =>
    openHistoryShell(
      historyStore,
      historyRepository,
      buildPickerActionContext({ container, taskLabel: "Watch history" }),
      releaseProgressCache,
      stateManager,
      queueService,
    ),
  );
  return "handled";
}

async function handleLibraryOverlay(
  container: Container,
  view: "library" | "queue",
): Promise<"handled"> {
  const { stateManager } = container;
  stateManager.dispatch({ type: "OPEN_OVERLAY", overlay: { type: "library", view } });
  await waitForOverlayClose(stateManager, "library");
  return "handled";
}

async function handleStaticOverlay(
  container: Container,
  type: "help" | "about",
): Promise<"handled"> {
  const { stateManager } = container;
  const lines =
    type === "help"
      ? [
          { label: "/ Command bar", detail: "Open global actions from anywhere in the shell." },
          {
            label: "Esc Clear or close",
            detail: "Clear the current transient state first, then close the top overlay.",
          },
          {
            label: "Enter Search or confirm",
            detail: "Searches when the query changed, otherwise confirms the selected result.",
          },
          {
            label: "↑↓ Navigate",
            detail: "Move through visible results, episodes, and picker options.",
          },
          {
            label: "Type to filter pickers",
            detail:
              "Season, episode, provider, subtitle, history, and settings pickers support filtering.",
          },
          {
            label: "Ctrl+W Delete previous word",
            detail: "Supported in the browse input and picker filters.",
          },
          {
            label: "Tab Switch destination mode",
            detail: "Jump directly into the destination mode shown in the footer.",
          },
          { label: "Ctrl+T Trending", detail: "Loads the cached discovery list on demand." },
          {
            label: "Playback actions",
            detail:
              "Replay, episode picker, provider switch, diagnostics, and more stay available after playback ends.",
          },
          {
            label: "Why commands are disabled",
            detail:
              "The footer and command palette show the reason instead of silently ignoring input.",
          },
        ]
      : [
          { label: "Version", detail: "v0.1.0" },
          { label: "Runtime", detail: `Bun ${Bun.version}  ·  Node ${process.versions.node}` },
          {
            label: "Current mode",
            detail: `${stateManager.getState().mode}  ·  Provider ${stateManager.getState().provider}`,
          },
          {
            label: "Capabilities",
            detail: container.capabilitySnapshot?.issues.length
              ? `${container.capabilitySnapshot.issues.length} degraded checks`
              : "all required available",
          },
          {
            label: "Privacy",
            detail: "Diagnostics stay local unless you explicitly export or share them.",
          },
        ];
  await withOverlay(stateManager, { type }, () =>
    openStaticInfoShell({
      title: type === "help" ? "Help" : "About",
      subtitle:
        type === "help" ? "Global commands, editing, filtering, and playback navigation" : "Kunai",
      lines,
    }),
  );
  return "handled";
}

async function handleDiagnostics(container: Container): Promise<"handled"> {
  const { stateManager, diagnosticsService, diagnosticsStore } = container;
  const memoryLine = getRuntimeMemoryLine();
  const memoryTrend = summarizeRuntimeMemoryTrend(getRuntimeMemorySamples());
  diagnosticsService.record({
    category: "runtime",
    operation: "runtime.memory.sample",
    message: "Runtime memory sample",
    context: { memory: memoryLine, trend: memoryTrend.detail, source: "diagnostics-command" },
  });
  const lines = buildDiagnosticsPanelLines({
    state: stateManager.getState(),
    recentEvents: diagnosticsStore.getRecent(25),
    memorySamples: getRuntimeMemorySamples(),
    capabilitySnapshot: container.capabilitySnapshot,
    downloadSummary: {
      active: container.downloadService.listActive(200).length,
      completed: container.downloadService.listCompleted(200).length,
      failed: container.downloadService.listFailed(200).length,
    },
    presenceSnapshot: container.presence.getSnapshot(),
  });
  await withOverlay(stateManager, { type: "diagnostics" }, () =>
    openStaticInfoShell({
      title: "Diagnostics",
      subtitle: "Health summary and redacted runtime evidence",
      lines,
    }),
  );
  return "handled";
}

async function handleProviderPicker(container: Container): Promise<"handled"> {
  const { stateManager, providerRegistry } = container;
  const state = stateManager.getState();
  const fromProviderId = state.provider;
  const picked = await withOverlay(
    stateManager,
    { type: "provider_picker", currentProvider: fromProviderId, isAnime: state.mode === "anime" },
    () =>
      openProviderPicker({
        currentProvider: fromProviderId,
        providers: providerRegistry
          .getAll()
          .map((p) => p.metadata)
          .filter((p) => p.isAnimeProvider === (state.mode === "anime")),
        actionContext: buildPickerActionContext({
          container,
          taskLabel: "Choose provider",
          allowed: ["settings", "history", "diagnostics", "help", "about", "quit"],
        }),
      }),
  );
  if (picked && picked !== fromProviderId) {
    const { applyUserProviderSwitch } = await import("@/app/playback-provider-switch");
    await applyUserProviderSwitch({
      container,
      fromProviderId,
      toProviderId: picked,
      ...(state.currentTitle && state.currentEpisode
        ? { title: state.currentTitle, episode: state.currentEpisode, mode: state.mode }
        : {}),
    });
    const playbackActive =
      state.playbackStatus === "loading" ||
      state.playbackStatus === "ready" ||
      state.playbackStatus === "buffering" ||
      state.playbackStatus === "seeking" ||
      state.playbackStatus === "stalled" ||
      state.playbackStatus === "playing";
    if (playbackActive && state.currentEpisode) {
      void container.playerControl.recomputeCurrentPlayback("provider-picker-switch");
    }
  }
  return "handled";
}

async function handleSettings(container: Container): Promise<"handled"> {
  const { stateManager, config, providerRegistry } = container;
  const next = await withOverlay(stateManager, { type: "settings" }, () =>
    openSettingsShell({
      container,
      current: config.getRaw(),
      historyStore: container.historyStore,
      actionContext: buildPickerActionContext({
        container,
        taskLabel: "Adjust settings",
        allowed: ["history", "diagnostics", "help", "about", "quit"],
      }),
      seriesProviders: providerRegistry
        .getAll()
        .map((p) => p.metadata)
        .filter((p) => !p.isAnimeProvider),
      animeProviders: providerRegistry
        .getAll()
        .map((p) => p.metadata)
        .filter((p) => p.isAnimeProvider),
    }),
  );
  if (next) {
    await applySettingsToRuntime({ container, next, previous: config.getRaw() });
  }
  return "handled";
}

async function handleClearCache(container: Container): Promise<"handled"> {
  const choice = await chooseFromListShell<"streams" | "all" | false>({
    title: "Clear cache?",
    subtitle: "Stream cache holds resolved URLs. Provider memory remembers per-title failures.",
    options: [
      { value: "streams", label: "Clear stream cache only" },
      { value: "all", label: "Clear stream cache and provider memory" },
      { value: false, label: "Cancel" },
    ],
  });
  if (choice === "streams" || choice === "all") {
    await container.cacheStore.clear();
    container.diagnosticsService.record({ category: "cache", message: "Stream cache cleared" });
  }
  if (choice === "all") {
    container.providerHealth.clearAll();
    container.titleProviderHealth.clearAll();
    container.diagnosticsService.record({
      category: "cache",
      message: "Stream cache and provider memory cleared",
    });
  }
  return "handled";
}

async function handleClearHistory(container: Container): Promise<"handled"> {
  const confirm = await chooseFromListShell({
    title: "Clear watch history?",
    subtitle: "This will remove all saved playback positions and progress.",
    options: [
      { value: true, label: "Yes, clear history" },
      { value: false, label: "Cancel" },
    ],
  });
  if (confirm) {
    await container.historyStore.clear();
    container.diagnosticsService.record({ category: "session", message: "Watch history cleared" });
  }
  return "handled";
}

async function handleExportDiagnostics(container: Container): Promise<"handled"> {
  const fileName = `kunai-diagnostics-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const path = join(process.cwd(), fileName);
  const state = container.stateManager.getState();
  const bundle = container.diagnosticsService.buildSupportBundle({
    capabilities: container.capabilitySnapshot as unknown as Record<string, unknown> | null,
    playbackSourceInventory: state.stream?.providerResolveResult
      ? buildPlaybackSourceInventoryDiagnosticsSummary(state.stream.providerResolveResult, {
          selectedSubtitleUrl: state.stream.subtitle,
        })
      : null,
  });
  await writeAtomicJson(path, bundle);
  await pruneOldDiagnosticFiles({
    dir: process.cwd(),
    prefix: "kunai-diagnostics-export-",
    maxFiles: 10,
  });
  container.diagnosticsService.record({
    category: "ui",
    operation: "export-diagnostics",
    message: "Diagnostics exported to file",
    context: { path: fileName, tracePath: container.debugTracePath },
  });
  return "handled";
}

async function handleReportIssue(container: Container): Promise<"handled"> {
  const reportAction = await chooseFromListShell({
    title: "Report an issue",
    subtitle:
      "Preview-first: export a redacted diagnostics bundle, then open GitHub when you are ready.",
    options: [
      {
        value: "export-and-open" as const,
        label: "Export diagnostics and open GitHub",
        detail: "Writes a redacted local JSON bundle, then opens the issue chooser",
      },
      {
        value: "open-only" as const,
        label: "Open GitHub only",
        detail: "No files are written by this action",
      },
      { value: "cancel" as const, label: "Cancel" },
    ],
  });
  if (!reportAction || reportAction === "cancel") return "handled";
  if (reportAction === "export-and-open") {
    const fileName = `kunai-diagnostics-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const path = join(process.cwd(), fileName);
    const state = container.stateManager.getState();
    const bundle = container.diagnosticsService.buildSupportBundle({
      capabilities: container.capabilitySnapshot as unknown as Record<string, unknown> | null,
      playbackSourceInventory: state.stream?.providerResolveResult
        ? buildPlaybackSourceInventoryDiagnosticsSummary(state.stream.providerResolveResult, {
            selectedSubtitleUrl: state.stream.subtitle,
          })
        : null,
    });
    await writeAtomicJson(path, bundle);
    const draft = buildIssueReportDraft({ bundle, diagnosticsPath: fileName });
    await pruneOldDiagnosticFiles({
      dir: process.cwd(),
      prefix: "kunai-diagnostics-report-",
      maxFiles: 10,
    });
    container.diagnosticsService.record({
      category: "ui",
      message: "Diagnostics report bundle exported",
      context: { path: fileName, issueTitle: draft.title, tracePath: container.debugTracePath },
    });
    await openIssueUrl(draft.issueUrl);
    return "handled";
  }
  await openIssueUrl();
  return "handled";
}

async function handleUpdate(container: Container): Promise<"handled"> {
  await openUpdateShell(container);
  return "handled";
}

async function openUpdateShell(container: Container): Promise<void> {
  const result = await container.updateService.checkForUpdate({ force: true });
  const status =
    result.status === "update-available"
      ? `Kunai ${result.latestVersion} is available. Current ${result.currentVersion}.`
      : result.status === "up-to-date"
        ? `Kunai is up to date (${result.currentVersion}).`
        : result.status === "error"
          ? `Update check failed: ${result.error ?? "unknown error"}`
          : `Update checks are ${result.status}.`;

  const choice = await chooseFromListShell({
    title: "Update",
    subtitle: result.guidance ? `${status}  ·  ${result.guidance}` : status,
    options: [
      {
        value: "snooze" as const,
        label: "Snooze update checks for 7 days",
        detail: "Mute automatic update notices temporarily",
      },
      {
        value: "disable" as const,
        label: "Disable automatic update checks",
        detail: "You can still run /update manually",
      },
      {
        value: "enable" as const,
        label: "Enable automatic update checks",
        detail: "Check at startup using the configured cache interval",
      },
      { value: "back" as const, label: "Back" },
    ],
  });

  if (choice === "snooze") {
    await container.updateService.snoozeForDays(7);
  } else if (choice === "disable") {
    await container.updateService.setChecksEnabled(false);
  } else if (choice === "enable") {
    await container.updateService.setChecksEnabled(true);
  }
}

export async function enqueueCurrentPlaybackDownload({
  container,
  reason,
}: {
  container: Container;
  reason: string;
}): Promise<boolean> {
  const state = container.stateManager.getState();
  if (!state.currentTitle || !state.currentEpisode) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Select a title first before downloading",
    });
    return false;
  }

  const eligibility = container.downloadService.getEnqueueEligibility();
  if (!eligibility.allowed) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Download unavailable: ${eligibility.reason}`,
    });
    container.diagnosticsService.record({
      category: "download",
      message: "Download enqueue blocked by feature gate",
      context: {
        reason,
        code: eligibility.code,
      },
    });
    return false;
  }

  try {
    const timing = await resolveTimingSnapshot(container);
    const job = await container.downloadService.enqueue({
      title: state.currentTitle,
      episode: state.currentEpisode,
      ...(state.stream ? { stream: state.stream } : {}),
      providerId: state.provider,
      mode: state.mode,
      posterUrl: state.currentTitle.posterUrl,
      audioPreference:
        state.mode === "anime"
          ? state.animeLanguageProfile.audio
          : state.currentTitle.type === "movie"
            ? state.movieLanguageProfile.audio
            : state.seriesLanguageProfile.audio,
      subtitlePreference:
        state.mode === "anime"
          ? state.animeLanguageProfile.subtitle
          : state.currentTitle.type === "movie"
            ? state.movieLanguageProfile.subtitle
            : state.seriesLanguageProfile.subtitle,
      qualityPreference:
        state.mode === "anime"
          ? state.animeLanguageProfile.quality
          : state.currentTitle.type === "movie"
            ? state.movieLanguageProfile.quality
            : state.seriesLanguageProfile.quality,
      selectedSourceId: getSelectedPlaybackSourceId(state.stream),
      selectedStreamId: state.stream?.providerResolveResult?.selectedStreamId,
      selectedQualityLabel: getSelectedPlaybackQualityLabel(state.stream),
      timing,
    });
    container.diagnosticsService.record({
      category: "download",
      message: "Download queued",
      context: {
        reason,
        jobId: job.id,
        titleId: job.titleId,
        season: job.season,
        episode: job.episode,
        provider: job.providerId,
        outputPath: job.outputPath,
      },
    });
    const successNote = `Download queued: ${job.titleName} S${String(job.season ?? 1).padStart(2, "0")}E${String(job.episode ?? 1).padStart(2, "0")}`;
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: successNote,
    });
    setTimeout(() => {
      if (container.stateManager.getState().playbackNote === successNote) {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: null,
        });
      }
    }, 3000);
    void container.downloadService.processQueue();
    return true;
  } catch (error) {
    const message =
      error instanceof DownloadEnqueueRejectedError
        ? error.reason
        : error instanceof Error
          ? error.message
          : String(error);
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Download queue failed: ${message}`,
    });
    container.diagnosticsService.record({
      category: "download",
      message: "Download queue failed",
      context: {
        reason,
        error: message,
      },
    });
    return false;
  }
}

function getSelectedPlaybackSourceId(stream: StreamInfo | null | undefined): string | undefined {
  const result = stream?.providerResolveResult;
  const selected = result?.streams.find((candidate) => candidate.id === result.selectedStreamId);
  return selected?.sourceId;
}

function getSelectedPlaybackQualityLabel(
  stream: StreamInfo | null | undefined,
): string | undefined {
  const result = stream?.providerResolveResult;
  const selected = result?.streams.find((candidate) => candidate.id === result.selectedStreamId);
  return selected?.qualityLabel;
}

export async function downloadSelectedResult(container: Container): Promise<void> {
  const { stateManager, providerRegistry } = container;
  const state = stateManager.getState();
  const selected = state.searchResults[state.selectedResultIndex];
  if (!selected) {
    stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Choose a title before queueing a download.",
    });
    return;
  }
  const title = titleInfoFromSearchResult(
    selected,
    chooseSearchResultTitle(selected, container.config.animeTitlePreference),
  );
  const { DownloadOnlyPhase } = await import("@/app/DownloadOnlyPhase");
  await new DownloadOnlyPhase({
    prepareConfirmedTitle: async () => {
      const mapped = await mapAnimeDiscoveryResultToProviderNative(selected, {
        mode: state.mode,
        providerId: state.provider,
        animeLanguageProfile: container.config.animeLanguageProfile,
        providerRegistry,
        signal: new AbortController().signal,
      });
      return titleInfoFromSearchResult(
        mapped,
        chooseSearchResultTitle(mapped, container.config.animeTitlePreference),
      );
    },
  }).execute({ title }, { container, signal: new AbortController().signal });
}

async function resolveTimingSnapshot(container: Container) {
  const control = await container.playerControl.waitForActivePlayer({
    timeoutMs: 300,
    signal: AbortSignal.timeout(500),
  });
  return control
    ? (((control as { getTimingSnapshot?: () => unknown }).getTimingSnapshot?.() as
        | import("@/domain/types").PlaybackTimingMetadata
        | null
        | undefined) ?? null)
    : null;
}

export async function resolveQuitWithDownloadQueue(
  container: Container,
): Promise<"handled" | "quit" | "unhandled"> {
  if (!container.downloadService.hasActiveJobs()) {
    return "quit";
  }

  const { openListShell } = await import("./ink-shell");
  const choice = await openListShell({
    title: "Active downloads running",
    subtitle: "Choose whether to keep, wait, or cancel downloads before quitting",
    options: [
      {
        value: "keep" as const,
        label: "Quit and keep downloads queued",
        detail: "Download queue stays in SQLite; processing resumes when Kunai runs again",
      },
      {
        value: "wait" as const,
        label: "Wait for downloads to finish, then quit",
        detail: "Process queued and running jobs before exiting",
      },
      {
        value: "cancel" as const,
        label: "Cancel active downloads, then quit",
        detail: "Abort queued/running jobs and remove temp files",
      },
      {
        value: "stay" as const,
        label: "Stay in Kunai",
      },
    ],
  });

  if (!choice || choice === "stay") {
    return "handled";
  }

  if (choice === "wait") {
    await container.downloadService.drainQueue();
    return "quit";
  }

  if (choice === "cancel") {
    for (const job of container.downloadService.listActive(200)) {
      await container.downloadService.abort(job.id);
    }
    return "quit";
  }

  return "quit";
}

export async function openProviderPicker({
  currentProvider,
  providers,
  actionContext,
}: {
  currentProvider: string;
  providers: readonly import("@/domain/types").ProviderMetadata[];
  actionContext?: ListShellActionContext;
}): Promise<string | null> {
  return chooseFromListShell({
    title: "Choose provider",
    subtitle: `Current provider ${currentProvider}`,
    actionContext,
    options: providers.map((provider) => ({
      value: provider.id,
      label: provider.id === currentProvider ? `${provider.name}  ·  current` : provider.name,
      detail: provider.description,
    })),
  });
}

export async function openSubtitlePicker(
  entries: ReadonlyArray<{
    url: string;
    display?: string;
    language?: string;
    release?: string;
    sourceKind?: "embedded" | "external";
    sourceName?: string;
  }>,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<string | null> {
  const describeSubtitleEntry = (entry: {
    language?: string;
    release?: string;
    sourceKind?: "embedded" | "external";
    sourceName?: string;
  }): string => {
    const parts = [entry.language ?? "unknown"];
    if (entry.sourceKind === "embedded") {
      parts.push("built-in");
    } else if (entry.sourceKind === "external") {
      parts.push("external");
    }
    if (entry.sourceName) {
      parts.push(entry.sourceName);
    }
    if (entry.release) {
      parts.push(entry.release);
    }
    return parts.join("  ·  ");
  };

  if (container) {
    return await openSessionPicker(container.stateManager, {
      type: "subtitle_picker",
      options: entries.map((entry) => ({
        value: entry.url,
        label: entry.display ?? entry.language ?? "Unknown track",
        detail: describeSubtitleEntry(entry),
      })),
    });
  }

  return chooseFromListShell({
    title: "Choose subtitles",
    subtitle: `${entries.length} tracks available`,
    actionContext,
    options: entries.map((entry) => ({
      value: entry.url,
      label: entry.display ?? entry.language ?? "Unknown track",
      detail: describeSubtitleEntry(entry),
    })),
  });
}

/**
 * Open the unified Tracks panel and await a switchable selection. `/tracks`
 * opens the whole surface; `/source` and `/quality` deep-link focus into their
 * section. Returns the decoded `{ section, value }` the caller applies through
 * the existing stream-selection handlers, or null when the user backs out (or
 * there was nothing switchable to resolve).
 */
export async function openTracksPanel(
  stream: StreamInfo | null,
  options: { initialSection?: TrackCapabilitySection; failedCurrentReason?: string },
  container: Container,
): Promise<DecodedTrackSelection | null> {
  const groups = options.failedCurrentReason
    ? annotateCurrentTrackFailure(
        buildTrackCapabilities(buildStreamInventoryView(stream)),
        options.failedCurrentReason,
      )
    : buildTrackCapabilities(buildStreamInventoryView(stream));
  const id = createSessionPickerId("tracks_panel");
  container.stateManager.dispatch({
    type: "OPEN_OVERLAY",
    overlay: {
      type: "tracks_panel",
      id,
      groups,
      initialSection: options.initialSection,
      favorites: container.config.favoriteSources,
    },
  });
  const resolved = await waitForSessionPicker(container.stateManager, id);
  return resolved ? decodeTrackSelection(resolved) : null;
}

export async function openSeasonPicker(
  tmdbId: string,
  currentSeason: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  const seasons = await fetchSeasonSummaries(tmdbId);
  if (!seasons) return null;
  return chooseSeasonFromOptions(seasons, currentSeason, actionContext, container);
}

export async function openEpisodePicker(
  tmdbId: string,
  season: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<EpisodeInfo | null> {
  const episodes = await fetchEpisodes(tmdbId, season);
  return chooseEpisodeFromOptions(episodes ?? [], season, currentEpisode, actionContext, container);
}

export async function openAnimeEpisodePicker(
  count: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  const episodes = Array.from({ length: count }, (_, index) => index + 1);
  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "episode_picker",
      season: 1,
      initialIndex: Math.max(0, currentEpisode - 1),
      options: episodes.map((episode) => ({
        value: String(episode),
        label: `Episode ${episode}`,
        tone: episode === currentEpisode ? "info" : undefined,
        badge: episode === currentEpisode ? "current" : undefined,
      })),
    });
    return picked ? Number.parseInt(picked, 10) : null;
  }
  return chooseFromListShell({
    title: "Choose episode",
    subtitle: `${count} episodes available`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode,
      label: episode === currentEpisode ? `Episode ${episode}  ·  current` : `Episode ${episode}`,
    })),
  });
}

export async function openAnimeEpisodeListPicker(
  episodes: readonly EpisodePickerOption[],
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  if (episodes.length === 0) return null;

  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "episode_picker",
      season: 1,
      initialIndex: Math.max(
        0,
        episodes.findIndex((episode) => episode.index === currentEpisode),
      ),
      options: episodes.map((episode) => ({
        value: String(episode.index),
        label: episode.label,
        detail: episode.detail,
        tone: episode.index === currentEpisode ? "info" : undefined,
        badge: episode.index === currentEpisode ? "current" : undefined,
      })),
    });
    return picked ? Number.parseInt(picked, 10) : null;
  }

  return chooseFromListShell({
    title: "Choose episode",
    subtitle: `${episodes.length} episodes available`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode.index,
      label: episode.index === currentEpisode ? `${episode.label}  ·  current` : episode.label,
      detail: episode.detail,
    })),
  });
}

function configSummary(config: KitsuneConfig): string {
  return `default ${config.defaultMode}  ·  provider ${config.provider}  ·  anime ${config.animeProvider}  ·  presence ${config.presenceProvider}`;
}

async function chooseQualityPreference(
  title: string,
  current: string | undefined,
  actionContext?: ListShellActionContext,
): Promise<(typeof QUALITY_OPTIONS)[number]["value"] | null> {
  const active = current ?? "best";
  return await chooseFromListShell({
    title,
    subtitle: `Current ${active}`,
    actionContext,
    options: QUALITY_OPTIONS.map((option) => ({
      value: option.value,
      label: option.value === active ? `${option.label}  ·  current` : option.label,
      detail: option.detail,
    })),
  });
}

export async function openSettingsShell({
  container,
  current,
  historyStore,
  actionContext,
  seriesProviders,
  animeProviders,
}: {
  container?: Container;
  current: KitsuneConfig;
  historyStore?: HistoryStore;
  actionContext?: ListShellActionContext;
  seriesProviders: readonly import("@/domain/types").ProviderMetadata[];
  animeProviders: readonly import("@/domain/types").ProviderMetadata[];
}): Promise<KitsuneConfig | null> {
  let next = { ...current };
  let changed = false;

  while (true) {
    const action = await chooseFromListShell({
      title: "Settings",
      subtitle: configSummary(next),
      actionContext,
      options: [
        {
          value: "defaultMode" as const,
          label: `Default startup mode  ·  ${next.defaultMode}`,
          detail: "Series or anime when the app launches",
        },
        {
          value: "provider" as const,
          label: `Default provider  ·  ${next.provider}`,
          detail: "Movies and series provider",
        },
        {
          value: "animeProvider" as const,
          label: `Anime provider  ·  ${next.animeProvider}`,
          detail: "Default anime source",
        },
        {
          value: "animeAudio" as const,
          label: `Anime audio  ·  ${next.animeLanguageProfile.audio}`,
          detail: "Preferred anime audio track language",
        },
        {
          value: "animeSubtitle" as const,
          label: `Anime subtitles  ·  ${next.animeLanguageProfile.subtitle}`,
          detail: "Preferred anime subtitle behavior",
        },
        {
          value: "animeQuality" as const,
          label: `Anime quality  ·  ${next.animeLanguageProfile.quality ?? "best"}`,
          detail: "Preferred anime stream quality",
        },
        {
          value: "seriesAudio" as const,
          label: `Series audio  ·  ${next.seriesLanguageProfile.audio}`,
          detail: "Preferred series audio track language",
        },
        {
          value: "seriesSubtitle" as const,
          label: `Series subtitles  ·  ${next.seriesLanguageProfile.subtitle}`,
          detail: "Preferred series subtitle behavior",
        },
        {
          value: "seriesQuality" as const,
          label: `Series quality  ·  ${next.seriesLanguageProfile.quality ?? "best"}`,
          detail: "Preferred series stream quality",
        },
        {
          value: "movieAudio" as const,
          label: `Movie audio  ·  ${next.movieLanguageProfile.audio}`,
          detail: "Preferred movie audio track language",
        },
        {
          value: "movieSubtitle" as const,
          label: `Movie subtitles  ·  ${next.movieLanguageProfile.subtitle}`,
          detail: "Preferred movie subtitle behavior",
        },
        {
          value: "movieQuality" as const,
          label: `Movie quality  ·  ${next.movieLanguageProfile.quality ?? "best"}`,
          detail: "Preferred movie stream quality",
        },
        {
          value: "showMemory" as const,
          label: `Memory panel  ·  ${next.showMemory ? "pinned after m" : "temporary after m"}`,
          detail:
            "Hidden by default. Press m during playback for app, mpv, total, heap, and swap usage",
        },
        {
          value: "autoNext" as const,
          label: `Autoplay next  ·  ${next.autoNext ? "on" : "off"}`,
          detail:
            "Close mpv on episode EOF, then continue through the next available released episode automatically",
        },
        {
          value: "resumeStartChoicePrompt" as const,
          label: `Resume vs start-over prompt  ·  ${next.resumeStartChoicePrompt ? "on" : "off"}`,
          detail:
            "When autoplay resumes mid-episode, show mpv overlay before seeking; off seeks immediately",
        },
        {
          value: "quitNearEndBehavior" as const,
          label: `Quit near end  ·  ${next.quitNearEndBehavior}`,
          detail: "Whether quitting mpv near the natural end can still trigger auto-next",
        },
        {
          value: "quitNearEndThresholdMode" as const,
          label: `Near-end detection  ·  ${next.quitNearEndThresholdMode}`,
          detail: "How Kunai decides you were close enough to the end for quit + completion",
        },
        {
          value: "skipRecap" as const,
          label: `Skip recaps  ·  ${next.skipRecap ? "on" : "off"}`,
          detail: "Auto-skip recap segments when IntroDB timing exists",
        },
        {
          value: "skipIntro" as const,
          label: `Skip intros  ·  ${next.skipIntro ? "on" : "off"}`,
          detail: "Auto-skip intro segments when IntroDB timing exists",
        },
        {
          value: "skipCredits" as const,
          label: `Skip credits  ·  ${next.skipCredits ? "on" : "off"}`,
          detail: "Skip to end of credits when detected; with autoNext on, advances immediately",
        },
        {
          value: "footerHints" as const,
          label: `Footer hints  ·  ${next.footerHints}`,
          detail: "Detailed keeps a two-line footer, minimal keeps only the task line",
        },
        {
          value: "recommendationRailEnabled" as const,
          label: `Post-playback recommendation rail  ·  ${next.recommendationRailEnabled ? "on" : "off"}`,
          detail: "Show compact recommendation picks after playback ends",
        },
        {
          value: "presenceProvider" as const,
          label: `Presence  ·  ${next.presenceProvider}`,
          detail: "Optional local Discord Rich Presence integration. Off by default.",
        },
        {
          value: "presencePrivacy" as const,
          label: `Presence privacy  ·  ${next.presencePrivacy}`,
          detail: "Controls how much title detail presence integrations may expose",
        },
        {
          value: "history" as const,
          label: "Manage history",
          detail: "Review and remove saved positions",
        },
        {
          value: "clearCache" as const,
          label: "Clear stream cache",
          detail: "Wipe the local SQLite stream cache",
        },
        {
          value: "clearHistory" as const,
          label: "Clear watch history",
          detail: "Reset all watch progress and history",
        },
        { value: "done" as const, label: changed ? "Save and close" : "Close" },
      ],
    });

    if (!action) {
      return null;
    }

    if (action === "done") {
      return changed ? next : null;
    }

    if (action === "history") {
      if (historyStore)
        await openHistoryShell(
          historyStore,
          container?.historyRepository,
          actionContext,
          container?.releaseProgressCache,
          container?.stateManager,
          container?.queueService,
        );
      continue;
    }

    if (action === "clearCache") {
      if (container) await handleShellAction({ action: "clear-cache", container });
      continue;
    }

    if (action === "clearHistory") {
      if (container) await handleShellAction({ action: "clear-history", container });
      continue;
    }

    if (action === "provider") {
      const picked = await chooseFromListShell({
        title: "Default provider",
        subtitle: `Current ${next.provider}`,
        actionContext,
        options: seriesProviders.map((provider) => ({
          value: provider.id,
          label: provider.id === next.provider ? `${provider.name}  ·  current` : provider.name,
          detail: provider.description,
        })),
      });
      if (picked && picked !== next.provider) {
        next.provider = picked;
        changed = true;
      }
      continue;
    }

    if (action === "defaultMode") {
      const picked = await chooseFromListShell({
        title: "Default startup mode",
        subtitle: `Current ${next.defaultMode}`,
        actionContext,
        options: [
          {
            value: "series" as const,
            label: next.defaultMode === "series" ? "Series mode  ·  current" : "Series mode",
            detail: "Browse movies and TV on launch",
          },
          {
            value: "anime" as const,
            label: next.defaultMode === "anime" ? "Anime mode  ·  current" : "Anime mode",
            detail: "Browse anime on launch",
          },
        ],
      });
      if (picked && picked !== next.defaultMode) {
        next.defaultMode = picked;
        changed = true;
      }
      continue;
    }

    if (action === "animeProvider") {
      const picked = await chooseFromListShell({
        title: "Anime provider",
        subtitle: `Current ${next.animeProvider}`,
        actionContext,
        options: animeProviders.map((provider) => ({
          value: provider.id,
          label:
            provider.id === next.animeProvider ? `${provider.name}  ·  current` : provider.name,
          detail: provider.description,
        })),
      });
      if (picked && picked !== next.animeProvider) {
        next.animeProvider = picked;
        changed = true;
      }
      continue;
    }

    if (action === "animeAudio") {
      const picked = await chooseFromListShell({
        title: "Anime audio",
        subtitle: `Current ${next.animeLanguageProfile.audio}`,
        actionContext,
        options: AUDIO_OPTIONS.map((option) => ({
          value: option.value,
          label:
            option.value === next.animeLanguageProfile.audio
              ? `${option.label}  ·  current`
              : option.label,
          detail: option.detail,
        })),
      });
      if (picked && picked !== next.animeLanguageProfile.audio) {
        next.animeLanguageProfile = { ...next.animeLanguageProfile, audio: picked };
        changed = true;
      }
      continue;
    }

    if (action === "animeSubtitle") {
      const picked = await chooseFromListShell({
        title: "Anime subtitles",
        subtitle: `Current ${next.animeLanguageProfile.subtitle}`,
        actionContext,
        options: SUBTITLE_OPTIONS.map((option) => ({
          value: option.value,
          label:
            option.value === next.animeLanguageProfile.subtitle
              ? `${option.label}  ·  current`
              : option.label,
        })),
      });
      if (picked && picked !== next.animeLanguageProfile.subtitle) {
        next.animeLanguageProfile = { ...next.animeLanguageProfile, subtitle: picked };
        changed = true;
      }
      continue;
    }

    if (action === "animeQuality") {
      const picked = await chooseQualityPreference(
        "Anime quality",
        next.animeLanguageProfile.quality,
        actionContext,
      );
      if (picked && picked !== next.animeLanguageProfile.quality) {
        next.animeLanguageProfile = { ...next.animeLanguageProfile, quality: picked };
        changed = true;
      }
      continue;
    }

    if (action === "seriesAudio") {
      const picked = await chooseFromListShell({
        title: "Series audio",
        subtitle: `Current ${next.seriesLanguageProfile.audio}`,
        actionContext,
        options: AUDIO_OPTIONS.map((option) => ({
          value: option.value,
          label:
            option.value === next.seriesLanguageProfile.audio
              ? `${option.label}  ·  current`
              : option.label,
          detail: option.detail,
        })),
      });
      if (picked && picked !== next.seriesLanguageProfile.audio) {
        next.seriesLanguageProfile = { ...next.seriesLanguageProfile, audio: picked };
        changed = true;
      }
      continue;
    }

    if (action === "seriesSubtitle") {
      const picked = await chooseFromListShell({
        title: "Series subtitles",
        subtitle: `Current ${next.seriesLanguageProfile.subtitle}`,
        actionContext,
        options: SUBTITLE_OPTIONS.map((option) => ({
          value: option.value,
          label:
            option.value === next.seriesLanguageProfile.subtitle
              ? `${option.label}  ·  current`
              : option.label,
        })),
      });
      if (picked && picked !== next.seriesLanguageProfile.subtitle) {
        next.seriesLanguageProfile = { ...next.seriesLanguageProfile, subtitle: picked };
        changed = true;
      }
      continue;
    }

    if (action === "seriesQuality") {
      const picked = await chooseQualityPreference(
        "Series quality",
        next.seriesLanguageProfile.quality,
        actionContext,
      );
      if (picked && picked !== next.seriesLanguageProfile.quality) {
        next.seriesLanguageProfile = { ...next.seriesLanguageProfile, quality: picked };
        changed = true;
      }
      continue;
    }

    if (action === "movieAudio") {
      const picked = await chooseFromListShell({
        title: "Movie audio",
        subtitle: `Current ${next.movieLanguageProfile.audio}`,
        actionContext,
        options: AUDIO_OPTIONS.map((option) => ({
          value: option.value,
          label:
            option.value === next.movieLanguageProfile.audio
              ? `${option.label}  ·  current`
              : option.label,
          detail: option.detail,
        })),
      });
      if (picked && picked !== next.movieLanguageProfile.audio) {
        next.movieLanguageProfile = { ...next.movieLanguageProfile, audio: picked };
        changed = true;
      }
      continue;
    }

    if (action === "movieSubtitle") {
      const picked = await chooseFromListShell({
        title: "Movie subtitles",
        subtitle: `Current ${next.movieLanguageProfile.subtitle}`,
        actionContext,
        options: SUBTITLE_OPTIONS.map((option) => ({
          value: option.value,
          label:
            option.value === next.movieLanguageProfile.subtitle
              ? `${option.label}  ·  current`
              : option.label,
        })),
      });
      if (picked && picked !== next.movieLanguageProfile.subtitle) {
        next.movieLanguageProfile = { ...next.movieLanguageProfile, subtitle: picked };
        changed = true;
      }
      continue;
    }

    if (action === "movieQuality") {
      const picked = await chooseQualityPreference(
        "Movie quality",
        next.movieLanguageProfile.quality,
        actionContext,
      );
      if (picked && picked !== next.movieLanguageProfile.quality) {
        next.movieLanguageProfile = { ...next.movieLanguageProfile, quality: picked };
        changed = true;
      }
      continue;
    }

    if (action === "showMemory") {
      next.showMemory = !next.showMemory;
      changed = true;
      continue;
    }

    if (action === "autoNext") {
      next.autoNext = !next.autoNext;
      changed = true;
      continue;
    }

    if (action === "resumeStartChoicePrompt") {
      next.resumeStartChoicePrompt = !next.resumeStartChoicePrompt;
      changed = true;
      continue;
    }

    if (action === "quitNearEndBehavior") {
      const picked = await chooseFromListShell({
        title: "Quit near end",
        subtitle: `Current ${next.quitNearEndBehavior}`,
        actionContext,
        options: [
          {
            value: "continue" as const,
            label: next.quitNearEndBehavior === "continue" ? "Continue  ·  current" : "Continue",
            detail: "Quitting mpv near the end still allows auto-next when enabled",
          },
          {
            value: "pause" as const,
            label: next.quitNearEndBehavior === "pause" ? "Pause chain  ·  current" : "Pause chain",
            detail: "Quitting mpv always stops the auto-next chain (EOF still advances)",
          },
        ],
      });
      if (picked && picked !== next.quitNearEndBehavior) {
        next.quitNearEndBehavior = picked;
        changed = true;
      }
      continue;
    }

    if (action === "quitNearEndThresholdMode") {
      const picked = await chooseFromListShell({
        title: "Near-end detection",
        subtitle: `Current ${next.quitNearEndThresholdMode}`,
        actionContext,
        options: [
          {
            value: "credits-or-90-percent" as const,
            label:
              next.quitNearEndThresholdMode === "credits-or-90-percent"
                ? "Credits or last 5s  ·  current"
                : "Credits or last 5s",
            detail: "Prefer AniSkip/IntroDB credits start, else last five seconds",
          },
          {
            value: "percent-only" as const,
            label:
              next.quitNearEndThresholdMode === "percent-only"
                ? "95% watched  ·  current"
                : "95% watched",
            detail: "Treat as near-end when watched ≥ 95% of reported duration",
          },
          {
            value: "seconds-only" as const,
            label:
              next.quitNearEndThresholdMode === "seconds-only"
                ? "Last 5 seconds  ·  current"
                : "Last 5 seconds",
            detail: "Ignore segment timing; only last five seconds count as near-end",
          },
        ],
      });
      if (picked && picked !== next.quitNearEndThresholdMode) {
        next.quitNearEndThresholdMode = picked;
        changed = true;
      }
      continue;
    }

    if (action === "skipRecap") {
      next.skipRecap = !next.skipRecap;
      changed = true;
      continue;
    }

    if (action === "skipIntro") {
      next.skipIntro = !next.skipIntro;
      changed = true;
      continue;
    }

    if (action === "skipCredits") {
      next.skipCredits = !next.skipCredits;
      changed = true;
      continue;
    }

    if (action === "footerHints") {
      const picked = await chooseFromListShell({
        title: "Footer hint density",
        subtitle: `Current ${next.footerHints}`,
        actionContext,
        options: [
          {
            value: "detailed" as const,
            label: next.footerHints === "detailed" ? "Detailed  ·  current" : "Detailed",
            detail: "Show the current task plus a second line of active shortcuts",
          },
          {
            value: "minimal" as const,
            label: next.footerHints === "minimal" ? "Minimal  ·  current" : "Minimal",
            detail: "Keep the current task visible and trim the shortcut line down",
          },
        ],
      });
      if (picked && picked !== next.footerHints) {
        next.footerHints = picked;
        changed = true;
      }
      continue;
    }

    if (action === "recommendationRailEnabled") {
      next.recommendationRailEnabled = !next.recommendationRailEnabled;
      changed = true;
      continue;
    }

    if (action === "presenceProvider") {
      const picked = await chooseFromListShell({
        title: "Presence integration",
        subtitle: `Current ${next.presenceProvider}`,
        actionContext,
        options: [
          {
            value: "off" as const,
            label: next.presenceProvider === "off" ? "Off  ·  current" : "Off",
            detail: "Do not publish local playback state anywhere",
          },
          {
            value: "discord" as const,
            label: next.presenceProvider === "discord" ? "Discord  ·  current" : "Discord",
            detail: "Use optional local Discord Rich Presence through Discord desktop IPC",
          },
        ],
      });
      if (picked && picked !== next.presenceProvider) {
        next.presenceProvider = picked;
        changed = true;
      }
      continue;
    }

    if (action === "presencePrivacy") {
      const picked = await chooseFromListShell({
        title: "Presence privacy",
        subtitle: `Current ${next.presencePrivacy}`,
        actionContext,
        options: [
          {
            value: "full" as const,
            label: next.presencePrivacy === "full" ? "Full  ·  current" : "Full",
            detail: "Show title and episode in supported presence integrations",
          },
          {
            value: "private" as const,
            label: next.presencePrivacy === "private" ? "Private  ·  current" : "Private",
            detail: "Show only that Kunai playback is active",
          },
        ],
      });
      if (picked && picked !== next.presencePrivacy) {
        next.presencePrivacy = picked;
        changed = true;
      }
    }
  }
}

// ─── Watchlist ─────────────────────────────────────────────────────────────────

/** Manual reclassification override — fix a wrongly-detected anime/series label on the current title. */
async function handleMarkKind(container: Container, kind: "anime" | "series"): Promise<"handled"> {
  const title = container.stateManager.getState().currentTitle;
  if (!title) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Play or select a title before reclassifying it.",
    });
    return "handled";
  }
  container.historyRepository.setMediaKind(title.id, kind);
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Marked "${title.name}" as ${kind} in your history.`,
  });
  return "handled";
}

/** Copy a "watch this" share code for the current title (+episode) to the clipboard. */
async function handleShare(container: Container): Promise<"handled"> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  if (!title) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Play or select a title before sharing it.",
    });
    return "handled";
  }
  const episode = state.currentEpisode;
  const code = encodeShareCode({
    id: title.id,
    type: title.type === "movie" ? "movie" : "series",
    name: title.name,
    ...(episode ? { season: episode.season, episode: episode.episode } : {}),
  });
  const copied = await copyToClipboard(code);
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: copied
      ? `Share code for "${title.name}" copied — send it to a friend, they run /watch.`
      : `Share code (copy manually): ${code}`,
  });
  return "handled";
}

/** Decode a Kunai share code from the clipboard and play that title. */
async function handleWatch(container: Container): Promise<ShellWorkflowResult> {
  const clip = await readClipboard();
  const payload = clip ? decodeShareCode(clip) : null;
  if (!payload) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "No Kunai share code on the clipboard. Copy a code (kunai1:…) then run /watch.",
    });
    return "handled";
  }
  return {
    type: "history-entry",
    title: { id: payload.id, type: payload.type, name: payload.name },
    episode:
      payload.season !== undefined && payload.episode !== undefined
        ? { season: payload.season, episode: payload.episode }
        : undefined,
  };
}

async function handleWatchlist(container: Container): Promise<"handled"> {
  const { listService, historyStore, releaseProgressCache } = container;
  const actionContext = buildPickerActionContext({ container, taskLabel: "Watchlist" });

  while (true) {
    const items = listService.getWatchlist();

    // Build per-title progress from history
    const progressMap = new Map<string, string>();
    const nextEpisodeMap = new Map<string, string>();
    const newEpisodeMap = new Map<string, number>();
    const history = await historyStore.getAll();
    const releaseProjections = releaseProgressCache.getByTitleIds(
      items.map((item) => item.titleId),
    );
    for (const item of items) {
      const latest = history[item.titleId];
      if (!latest) continue;
      const epCode =
        historyContentType(latest) === "series" && latest.season && latest.episode
          ? `S${String(latest.season).padStart(2, "0")}E${String(latest.episode).padStart(2, "0")}`
          : null;
      const progress = projectWatchProgress({
        timestamp: latest.positionSeconds,
        duration: latest.durationSeconds,
        completed: latest.completed,
      });
      const statusLabel = isFinished(latest)
        ? "watched"
        : progress.percentage !== null
          ? `${progress.percentage}%`
          : "in progress";
      const dateLabel = relativeHistoryDate(latest.updatedAt);
      progressMap.set(item.titleId, [epCode, statusLabel, dateLabel].filter(Boolean).join(" · "));

      // Compute next episode to watch (last watched + 1 for series)
      if (historyContentType(latest) === "series" && latest.season && latest.episode) {
        const nextEp = isFinished(latest)
          ? `S${String(latest.season).padStart(2, "0")}E${String(latest.episode + 1).padStart(2, "0")}`
          : epCode;
        if (nextEp) nextEpisodeMap.set(item.titleId, nextEp);
      }

      const release = releaseProjections.get(item.titleId);
      if (release?.status === "new-episodes" && release.newEpisodeCount > 0) {
        newEpisodeMap.set(item.titleId, release.newEpisodeCount);
      }
    }

    type WlAction = { type: "select"; titleId: string; title: string } | { type: "back" };

    const options: ShellOption<WlAction>[] = [
      ...items.map((item) => {
        const progress = progressMap.get(item.titleId);
        const nextEp = nextEpisodeMap.get(item.titleId);
        const newCount = newEpisodeMap.get(item.titleId);
        const newBadge = newCount ? `+${newCount} new` : null;
        const nextBadge = nextEp ? `→ ${nextEp}` : null;
        const detail = [item.mediaKind, progress ?? "not started", nextBadge, newBadge]
          .filter(Boolean)
          .join("  ·  ");
        return {
          value: { type: "select" as const, titleId: item.titleId, title: item.title },
          label: newCount ? `${item.title}  ·  +${newCount} new` : item.title,
          detail,
        };
      }),
      { value: { type: "back" as const }, label: "Back" },
    ];

    const subtitle =
      items.length > 0
        ? `${items.length} title${items.length === 1 ? "" : "s"}`
        : "Nothing in your watchlist yet. Add titles from search results via /wl.";

    const picked = await chooseFromListShell({
      title: "Watchlist",
      subtitle,
      actionContext,
      options,
    });

    if (!picked || picked.type === "back") return "handled";

    type SubAction = "search" | "remove" | "back";

    const sub = await chooseFromListShell({
      title: picked.title,
      subtitle: "What would you like to do?",
      actionContext,
      options: [
        {
          value: "search" as SubAction,
          label: "Open in search",
          detail: "Search for this title to play it",
        },
        { value: "remove" as SubAction, label: "Remove from watchlist" },
        { value: "back" as SubAction, label: "Back" },
      ],
    });

    if (!sub || sub === "back") continue;

    if (sub === "search") {
      container.stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: picked.title });
      return "handled";
    }

    if (sub === "remove") {
      const confirm = await chooseFromListShell({
        title: `Remove "${picked.title}" from watchlist?`,
        subtitle: "This only removes it from your watchlist, not your history",
        actionContext,
        options: [
          { value: true, label: "Remove from watchlist" },
          { value: false, label: "Keep it" },
        ],
      });
      if (confirm) listService.removeFromWatchlist(picked.titleId);
    }
  }
}

// ─── Favorites ─────────────────────────────────────────────────────────────────

async function handleFavorites(container: Container): Promise<"handled"> {
  const { listService } = container;
  const actionContext = buildPickerActionContext({ container, taskLabel: "Favorites" });

  while (true) {
    const items = listService.getFavorites();

    type FavAction = { type: "remove"; titleId: string; title: string } | { type: "back" };

    const options: ShellOption<FavAction>[] = [
      ...items.map((item) => ({
        value: { type: "remove" as const, titleId: item.titleId, title: item.title },
        label: item.title,
        detail: item.mediaKind,
      })),
      { value: { type: "back" as const }, label: "Back" },
    ];

    const subtitle =
      items.length > 0
        ? `${items.length} title${items.length === 1 ? "" : "s"}  ·  select to remove`
        : "No favorites yet.";

    const picked = await chooseFromListShell({
      title: "Favorites",
      subtitle,
      actionContext,
      options,
    });

    if (!picked || picked.type === "back") return "handled";

    listService.removeFromFavorites(picked.titleId);
  }
}

// ─── Playlist ──────────────────────────────────────────────────────────────────

async function handlePlaylist(container: Container): Promise<ShellWorkflowResult> {
  const { queueService, listService } = container;
  const actionContext = buildPickerActionContext({ container, taskLabel: "Playlist" });

  while (true) {
    const status = queueService.getStatus();
    const all = queueService.getAll();

    type PlAction =
      | {
          type: "item";
          id: string;
          title: string;
          mediaKind: string;
          titleId: string;
          season?: number;
          episode?: number;
          played: boolean;
        }
      | { type: "clear-played" }
      | { type: "clear-all" }
      | { type: "refill" }
      | { type: "snapshot-queue" }
      | { type: "export-durable" }
      | { type: "import-durable" }
      | { type: "back" };

    const staleNote =
      status.isStale && status.lastActivityAt
        ? `  ·  last active ${describeStaleness(status.lastActivityAt)}`
        : "";

    const subtitle =
      all.length > 0
        ? `${status.unplayedCount} up next · ${all.length - status.unplayedCount} played${staleNote}`
        : "Playlist is empty. Add titles via /playlist-add or [r] refill from watchlist.";

    const firstUnplayedId = all.find((i) => !i.playedAt)?.id;

    const options: ShellOption<PlAction>[] = [
      ...all.map((item) => {
        const ep =
          item.season !== null &&
          item.season !== undefined &&
          item.episode !== null &&
          item.episode !== undefined
            ? ` S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`
            : "";
        const played = item.playedAt !== undefined;
        const isNext = !played && item.id === firstUnplayedId;
        const addedLabel = relativeHistoryDate(item.addedAt);
        const prefix = played ? "✓  " : isNext ? "▶  " : "   ";
        const label = `${prefix}${item.title}${ep}`;
        const detail = played
          ? `played ${relativeHistoryDate(item.playedAt ?? item.addedAt)}  ·  ${item.mediaKind}`
          : isNext
            ? `next up  ·  ${item.mediaKind}  ·  added ${addedLabel}`
            : `queued  ·  ${item.mediaKind}  ·  added ${addedLabel}`;
        return {
          value: {
            type: "item" as const,
            id: item.id,
            title: item.title,
            mediaKind: item.mediaKind,
            titleId: item.titleId,
            season: item.season,
            episode: item.episode,
            played,
          },
          label,
          detail,
        };
      }),
      ...(all.some((i) => i.playedAt)
        ? [{ value: { type: "clear-played" as const }, label: "Clear played items" }]
        : []),
      ...(all.length > 0
        ? [{ value: { type: "clear-all" as const }, label: "Clear entire playlist" }]
        : []),
      ...(all.length > 0
        ? [
            {
              value: { type: "snapshot-queue" as const },
              label: "Save queue as durable playlist",
              detail: "Create a shareable playlist from the current queue identities",
            },
          ]
        : []),
      {
        value: { type: "export-durable" as const },
        label: "Export durable playlist",
        detail: "Write a safe Kunai playlist JSON file",
      },
      {
        value: { type: "import-durable" as const },
        label: "Import durable playlist",
        detail: "Read a Kunai playlist JSON file from the playlist exchange folder",
      },
      { value: { type: "refill" as const }, label: "Refill from watchlist" },
      { value: { type: "back" as const }, label: "Back" },
    ];

    const picked = await chooseFromListShell({
      title: `Playlist · ${status.unplayedCount} up next`,
      subtitle,
      actionContext,
      options,
    });

    if (!picked || picked.type === "back") return "handled";

    if (picked.type === "refill") {
      const added = queueService.refillFromWatchlist(listService);
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: added > 0 ? `Added ${added} titles from watchlist.` : "Nothing new to add.",
      });
      continue;
    }

    if (picked.type === "snapshot-queue") {
      const playlist = container.durablePlaylistService.createPlaylist(
        `Queue ${new Date().toISOString().slice(0, 10)}`,
        "Saved from the runtime queue",
      );
      for (const item of all) {
        container.durablePlaylistService.addItem(playlist.id, {
          titleId: item.titleId,
          mediaKind: item.mediaKind,
          title: item.title,
          season: item.season,
          episode: item.episode,
          absoluteEpisode: item.absoluteEpisode,
        });
      }
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Saved ${all.length} queue items to "${playlist.name}".`,
      });
      continue;
    }

    if (picked.type === "export-durable") {
      await exportDurablePlaylist(container, actionContext);
      continue;
    }

    if (picked.type === "import-durable") {
      await importDurablePlaylist(container, actionContext);
      continue;
    }

    if (picked.type === "clear-played") {
      queueService.clearPlayed();
      continue;
    }

    if (picked.type === "clear-all") {
      const confirm = await chooseFromListShell({
        title: "Clear entire playlist?",
        subtitle: "This cannot be undone",
        actionContext,
        options: [
          { value: true, label: "Yes, clear all" },
          { value: false, label: "Cancel" },
        ],
      });
      if (confirm) queueService.clear();
      continue;
    }

    if (picked.type === "item") {
      const unplayedIds = all.filter((i) => !i.playedAt).map((i) => i.id);
      const unplayedIndex = unplayedIds.indexOf(picked.id);
      const canMoveUp = !picked.played && unplayedIndex > 0;
      const canMoveDown =
        !picked.played && unplayedIndex >= 0 && unplayedIndex < unplayedIds.length - 1;
      const itemAction = await chooseFromListShell({
        title: picked.title,
        subtitle: picked.played
          ? "Played queue item"
          : "Queued item  ·  play now or manage this entry",
        actionContext,
        options: [
          ...(picked.played
            ? []
            : [
                {
                  value: "play" as const,
                  label: "Play now",
                  detail: "Start this queue item immediately",
                },
              ]),
          ...(canMoveUp
            ? [
                {
                  value: "move-up" as const,
                  label: "Move up",
                  detail: "Play this earlier in the queue",
                },
              ]
            : []),
          ...(canMoveDown
            ? [
                {
                  value: "move-down" as const,
                  label: "Move down",
                  detail: "Play this later in the queue",
                },
              ]
            : []),
          {
            value: "back" as const,
            label: "Back",
            detail: "Keep this item in the queue",
          },
          {
            value: "remove" as const,
            label: "Remove from queue",
            detail: "Delete only this queue item",
          },
        ],
      });
      if (itemAction === "remove") {
        queueService.remove(picked.id);
      } else if (itemAction === "move-up") {
        queueService.moveUp(picked.id);
        continue;
      } else if (itemAction === "move-down") {
        queueService.moveDown(picked.id);
        continue;
      } else if (itemAction === "play") {
        return {
          type: "history-entry",
          title: {
            id: picked.titleId,
            type: picked.mediaKind === "movie" ? "movie" : "series",
            name: picked.title,
          },
          episode:
            picked.season !== undefined && picked.episode !== undefined
              ? { season: picked.season, episode: picked.episode }
              : undefined,
        };
      }
      continue;
    }
  }
}

async function ensurePlaylistExchangeDir(): Promise<string> {
  const dir = join(getKunaiPaths().dataDir, "playlists");
  await mkdir(dir, { recursive: true });
  return dir;
}

async function exportDurablePlaylist(
  container: Container,
  actionContext: ListShellActionContext,
): Promise<void> {
  const playlists = container.durablePlaylistService.listPlaylists();
  if (playlists.length === 0) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "No durable playlists to export. Save the queue as a playlist first.",
    });
    return;
  }

  const picked = await chooseFromListShell({
    title: "Export Playlist",
    subtitle: "Exports identity and progress only; never stream URLs or local paths",
    actionContext,
    options: playlists.map((playlist) => ({
      value: playlist.id,
      label: playlist.name,
      detail: playlist.description,
    })),
  });
  if (!picked) return;

  const playlist = playlists.find((item) => item.id === picked);
  if (!playlist) return;
  const document = container.durablePlaylistService.exportPlaylist(playlist.id, playlist.name, []);
  const dir = await ensurePlaylistExchangeDir();
  const filePath = join(dir, `${safeFileSlug(playlist.name)}.kunai-playlist.json`);
  await Bun.write(filePath, `${JSON.stringify(document, null, 2)}\n`);
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Exported playlist to ${filePath}.`,
  });
}

async function importDurablePlaylist(
  container: Container,
  actionContext: ListShellActionContext,
): Promise<void> {
  const dir = await ensurePlaylistExchangeDir();
  const files = (await readdir(dir)).filter(
    (name) => name.endsWith(".kunai-playlist.json") || name.endsWith(".json"),
  );
  if (files.length === 0) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `No playlist files found in ${dir}.`,
    });
    return;
  }

  const picked = await chooseFromListShell({
    title: "Import Playlist",
    subtitle: `Choose a Kunai playlist file from ${dir}`,
    actionContext,
    options: files.map((file) => ({
      value: join(dir, file),
      label: basename(file),
    })),
  });
  if (!picked) return;

  const document = parseKunaiPlaylistDocument(await readFile(picked, "utf8"));
  const playlist = container.durablePlaylistService.importPlaylist(document);
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Imported "${playlist.name}" without autoplaying anything.`,
  });
}

function parseKunaiPlaylistDocument(json: string): KunaiPlaylistDocument {
  const parsed = JSON.parse(json) as KunaiPlaylistDocument;
  if (parsed.format !== "kunai-playlist" || parsed.version !== 1 || !Array.isArray(parsed.items)) {
    throw new Error("Invalid Kunai playlist document");
  }
  return parsed;
}

function safeFileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "playlist";
}

function describeStaleness(lastActivityAt: string): string {
  const ms = Date.now() - new Date(lastActivityAt).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

async function handlePlaylistAdd(container: Container): Promise<"handled"> {
  const { stateManager, queueService } = container;
  const state = stateManager.getState();

  const title = state.currentTitle;
  if (!title) {
    stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "No current title to add to playlist.",
    });
    return "handled";
  }

  queueService.enqueue({
    title: title.name,
    mediaKind: state.mode === "anime" ? "anime" : "series",
    titleId: title.id,
    season: state.currentEpisode?.season,
    episode: state.currentEpisode?.episode,
    source: "manual",
  });

  stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Added "${title.name}" to playlist.`,
  });
  return "handled";
}

// ─── Stats ──────────────────────────────────────────────────────────────────────

async function handleStats(container: Container): Promise<"handled"> {
  const { openStatsShell } = await import("./ink-shell");
  await openStatsShell(container);
  return "handled";
}

// ─── Sync ────────────────────────────────────────────────────────────────────────

async function handleSync(container: Container): Promise<"handled"> {
  const { syncService } = container;
  const actionContext = buildPickerActionContext({ container, taskLabel: "Sync" });

  while (true) {
    const adapters = syncService.adapters;

    type SyncAction =
      | { type: "connect"; id: string }
      | { type: "disconnect"; id: string }
      | { type: "push-now" }
      | { type: "back" };

    const options: ShellOption<SyncAction>[] = [
      ...adapters.map((adapter) => {
        const connected = adapter.isConnected();
        const username = adapter.getConnectedUsername();
        return {
          value: connected
            ? ({ type: "disconnect", id: adapter.id } as SyncAction)
            : ({ type: "connect", id: adapter.id } as SyncAction),
          label: connected
            ? `${adapter.displayName}  ·  connected${username ? ` as @${username}` : ""}`
            : `${adapter.displayName}  ·  not connected`,
          detail: connected ? "Select to disconnect" : "Select to connect",
        };
      }),
      { value: { type: "push-now" as const }, label: "Sync now" },
      { value: { type: "back" as const }, label: "Back" },
    ];

    const connectedCount = adapters.filter((a) => a.isConnected()).length;
    const subtitle =
      connectedCount > 0
        ? `${connectedCount} service${connectedCount === 1 ? "" : "s"} connected`
        : "No sync services connected. Select a service to link your account.";

    const picked = await chooseFromListShell({
      title: "Sync",
      subtitle,
      actionContext,
      options,
    });

    if (!picked || picked.type === "back") return "handled";

    if (picked.type === "push-now") {
      // Use historyRepository directly to get HistoryProgress — no lossy adapter mapping.
      const entries = container.historyRepository.listRecent(20);

      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Syncing ${entries.length} entries…`,
      });

      for (const entry of entries) {
        await syncService.pushWatched(entry);
      }

      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: "Sync complete.",
      });
      continue;
    }

    if (picked.type === "connect") {
      const adapter = adapters.find((a) => a.id === picked.id);
      if (!adapter) continue;

      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Connecting to ${adapter.displayName}…`,
      });

      const controller = new AbortController();
      const result = await adapter.connect(controller.signal);

      if (result.ok) {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Connected to ${adapter.displayName}.`,
        });
      } else {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Failed: ${result.error}`,
        });
      }
      continue;
    }

    if (picked.type === "disconnect") {
      const adapter = adapters.find((a) => a.id === picked.id);
      if (!adapter) continue;

      const confirm = await chooseFromListShell({
        title: `Disconnect ${adapter.displayName}?`,
        subtitle: "Your local history will be kept",
        actionContext,
        options: [
          { value: true, label: `Yes, disconnect ${adapter.displayName}` },
          { value: false, label: "Cancel" },
        ],
      });

      if (confirm) {
        await adapter.disconnect();
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Disconnected from ${adapter.displayName}.`,
        });
      }
      continue;
    }
  }
}

async function handleSyncConnectAniList(container: Container): Promise<"handled"> {
  await handleSync(container);
  return "handled";
}

async function handleSyncConnectTmdb(container: Container): Promise<"handled"> {
  await handleSync(container);
  return "handled";
}

async function handleSyncDisconnect(container: Container): Promise<"handled"> {
  await handleSync(container);
  return "handled";
}
