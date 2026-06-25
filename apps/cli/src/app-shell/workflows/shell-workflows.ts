import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  chooseFromListShell,
  type ListShellActionContext,
  type ShellOption,
} from "@/app-shell/pickers";
import { resolveShareTarget } from "@/app/bootstrap/resolve-share-target";
import { buildShareRefFromTitleContext } from "@/app/bootstrap/share-ref-from-context";
import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/discover/anime-provider-mapping";
import { requestUnifiedOfflinePlayback } from "@/app/offline/offline-playback-launch";
import { applyProviderPickerSelection } from "@/app/playback/playback-provider-switch";
import { chooseSearchResultTitle } from "@/app/search/browse-option-mappers";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";
import { createContinuationEngine } from "@/domain/continuation/ContinuationEngine";
import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import { planEpisodeQueue } from "@/domain/queue/QueuePlanner";
import type { SessionState } from "@/domain/session/SessionState";
import {
  encodePlaybackTargetRef,
  parsePlaybackTargetRef,
} from "@/domain/share/playback-target-ref";
import type { EpisodeInfo as PlaybackEpisodeInfo, StreamInfo, TitleInfo } from "@/domain/types";
import { copyToClipboard, readClipboard } from "@/infra/clipboard";
import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { revealPathInOsFileManager } from "@/infra/os/reveal-in-file-manager";
import { openExternalUrlAndWait, defaultKunaiDocsUrl } from "@/infra/shell/open-external-url";
import {
  readLatestHistoryByTitle,
  formatTimestamp,
  historyContentType,
  isFinished,
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
import { resolveDownloadQualityCeiling } from "@/services/download/download-quality-policy";
import { DownloadEnqueueRejectedError } from "@/services/download/DownloadService";
import { createContainerMediaActionRouter } from "@/services/media-actions/create-container-media-action-router";
import { formatOfflineHistoryProgress } from "@/services/offline/offline-history-progress";
import {
  formatOfflineJobListingTitle,
  formatOfflineShelfBadge,
  formatOfflineShelfDetail,
  formatOfflineSecondaryLine,
  offlineStatusIcon,
  resolveOfflineArtifactStatus,
  resolveOfflineJobPreviewImage,
} from "@/services/offline/offline-library";
import { buildPlaybackSourceInventoryDiagnosticsSummary } from "@/services/playback/PlaybackSourceInventoryProjection";
import type { KunaiPlaylistDocument } from "@/services/playlists/KunaiPlaylistFormat";
import { getKunaiPaths, type DownloadJobRecord } from "@/services/storage/storage-read-models";
import { fetchEpisodes } from "@/tmdb";
import type { MediaKind } from "@kunai/types";

import { resolveCommands } from "../commands";
import { buildDiagnosticsPanelLines } from "../panel-data";
import { openRootOwnedOverlay } from "../root-overlay-bridge";
import type { ShellAction } from "../types";
import { relativeHistoryDate } from "./history-workflows";
import { openProviderPicker } from "./picker-workflows";
import { openSetupWizardFromShell } from "./setup-workflows";

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

function describeDownloadJob(job: DownloadJobRecord): string {
  return formatOfflineJobListingTitle(job);
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
      networkAvailable: container.connectivity.isOnline(),
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
      await requestUnifiedOfflinePlayback(container, job.id);
      return;
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

export async function queueMoreOfflineTitleEpisodes(
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
  const { DownloadOnlyPhase } = await import("@/app/playback/DownloadOnlyPhase");
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

async function openIssueUrl(
  url = "https://github.com/kitsunekode/kunai/issues/new/choose",
): Promise<void> {
  await openExternalUrlAndWait(url);
}

async function openDocsUrl(url = defaultKunaiDocsUrl()): Promise<void> {
  await openExternalUrlAndWait(url);
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
  allowed?: readonly import("../commands").AppCommandId[];
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

export type ShellWorkflowResult =
  | "handled"
  | "quit"
  | "unhandled"
  | {
      type: "history-entry";
      title: TitleInfo;
      episode?: PlaybackEpisodeInfo;
      startSeconds?: number;
    };

type ActionHandler = (container: Container) => Promise<ShellWorkflowResult>;

async function handleTitleControlMenu(container: Container): Promise<"handled"> {
  const state = container.stateManager.getState();
  const surface =
    state.playbackStatus === "playing"
      ? "playing"
      : state.playbackStatus === "loading" ||
          state.playbackStatus === "ready" ||
          state.playbackStatus === "buffering"
        ? "loading"
        : state.activeModals.some((overlay) => overlay.type === "library")
          ? "library"
          : "browse";
  const { openTitleControlMenu } =
    await import("@/app-shell/title-control/open-title-control-menu");
  await openTitleControlMenu(container, surface);
  return "handled";
}

const actionHandlers: Record<string, ActionHandler | undefined> = {
  quit: (c) => resolveQuitWithDownloadQueue(c),
  continue: (c) => handleContinue(c),
  history: (c) => handleHistory(c),
  download: (c) => {
    void downloadSelectedResult(c);
    return Promise.resolve("handled");
  },
  downloads: (c) => handleLibraryOverlay(c, "queue"),
  library: (c) => handleLibraryOverlay(c, "library"),
  menu: (c) => handleTitleControlMenu(c),
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
  setup: async (container) => {
    await openSetupWizardFromShell(container, { force: true, closeOverlays: true });
    return "handled";
  },
  "clear-cache": (c) => handleClearCache(c),
  "reset-provider-health": (c) => handleResetProviderHealth(c),
  "clear-history": (c) => handleClearHistory(c),
  "export-diagnostics": (c) => handleExportDiagnostics(c),
  "report-issue": (c) => handleReportIssue(c),
  update: (c) => handleUpdate(c),
  "mark-anime": (c) => handleMarkKind(c, "anime"),
  "mark-series": (c) => handleMarkKind(c, "series"),
  share: (c) => handleShare(c),
  bookmark: (c) => handleBookmark(c),
  follow: (c) => handleAttentionPreference(c, "following"),
  unfollow: (c) => handleAttentionPreference(c, "implicit"),
  mute: (c) => handleAttentionPreference(c, "muted"),
  "mark-watched": (c) => handleMarkWatched(c),
  "mark-unwatched": (c) => handleMarkUnwatched(c),
  "mark-season-watched": (c) => handleMarkSeasonWatched(c),
  "mark-up-to-episode": (c) => handleMarkUpToEpisode(c),
  watch: (c) => handleWatch(c),
  watchlist: (c) => handleWatchlist(c),
  favorites: (c) => handleFavorites(c),
  playlists: (c) => handlePlaylists(c),
  "up-next": (c) => handleUpNext(c),
  playlist: (c) => handlePlaylists(c),
  "playlist-add": (c) => handlePlaylistAdd(c),
  "queue-season": (c) => handleQueueSeason(c),
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

/** Close the active overlay (or cancel a picker) before running a workflow command. */
export async function runShellWorkflowFromOverlay(
  container: Container,
  action: ShellAction,
  options: {
    readonly cancelPickerId?: string;
    readonly execute?: (
      input: Parameters<typeof handleShellAction>[0],
    ) => ReturnType<typeof handleShellAction>;
  } = {},
): Promise<ShellWorkflowResult> {
  if (options.cancelPickerId) {
    container.stateManager.dispatch({ type: "CANCEL_PICKER", id: options.cancelPickerId });
  } else if (container.stateManager.getState().activeModals.length > 0) {
    container.stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
  }
  const execute = options.execute ?? handleShellAction;
  return execute({ action, container });
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
    const top = stateManager.getState().activeModals.at(-1);
    if (top?.type === overlay.type) {
      stateManager.dispatch({ type: "CLOSE_TOP_OVERLAY" });
    }
  }
};

async function handleHistory(container: Container): Promise<"handled"> {
  await openRootOwnedOverlay(container, { type: "history" });
  return "handled";
}

async function handleContinue(container: Container): Promise<"handled"> {
  await openRootOwnedOverlay(container, { type: "history", initialFilterMode: "watching" });
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
  const { stateManager, diagnosticsService } = container;
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
    recentEvents: diagnosticsService.getRecent(container.debugTracePath ? 50 : 25),
    developerMode: Boolean(container.debugTracePath),
    memorySamples: getRuntimeMemorySamples(),
    capabilitySnapshot: container.capabilitySnapshot,
    downloadSummary: {
      active: container.downloadService.listActive(200).length,
      completed: container.downloadService.listCompleted(200).length,
      failed: container.downloadService.listFailed(200).length,
    },
    releaseSummary: container.releaseProgressCache.summarizeActive(),
    releaseDiagnostics: container.releaseProgressCache.summarizeDiagnostics(),
    presenceSnapshot: container.presence.getSnapshot(),
    providers: container.providerRegistry.getAll().map((provider) => provider.metadata),
    getProviderHealth: (providerId) => container.providerHealth.get(providerId),
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
  if (picked) {
    await applyProviderPickerSelection({
      container,
      pickedProviderId: picked,
      reason: "provider-picker-switch",
    });
  }
  return "handled";
}

async function handleSettings(container: Container): Promise<"handled"> {
  await openRootOwnedOverlay(container, { type: "settings" });
  return "handled";
}

async function handleResetProviderHealth(container: Container): Promise<"handled"> {
  const { applyProviderHealthResetScope, buildProviderHealthResetOptions } =
    await import("@/services/playback/provider-health-reset");
  const scope = await chooseFromListShell({
    title: "Reset provider health?",
    subtitle:
      "Forgets down/degraded status so auto-fallback can try those providers again. Does not clear cached stream URLs.",
    options: buildProviderHealthResetOptions(container),
  });
  if (!scope) return "handled";
  await applyProviderHealthResetScope(container, scope);
  return "handled";
}

async function handleClearCache(container: Container): Promise<"handled"> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const episode = state.currentEpisode;
  const episodeCode =
    title && episode
      ? `S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`
      : null;

  const choice = await chooseFromListShell<
    "episode" | "title" | "streams" | "provider-memory" | "all" | false
  >({
    title: "Clear cache?",
    subtitle:
      "Stream cache = saved m3u8 URLs. Provider memory = failure history that can skip fallbacks.",
    options: [
      ...(title && episode
        ? [
            {
              value: "episode" as const,
              label: `Purge episode stream cache${episodeCode ? `  ·  ${episodeCode}` : ""}`,
              detail: `Drop cached URLs and source inventory for ${title.name}`,
            },
          ]
        : []),
      ...(title
        ? [
            {
              value: "title" as const,
              label: `Purge title stream cache  ·  ${title.name}`,
              detail: "Drop cached stream URLs for every episode you've watched on this title",
            },
          ]
        : []),
      {
        value: "streams",
        label: "Clear entire stream cache",
        detail: "All cached m3u8 URLs and resolve results — provider memory is kept",
      },
      {
        value: "provider-memory",
        label: "Reset provider health memory…",
        detail: "Opens scoped reset for down/degraded providers and per-show failures",
      },
      {
        value: "all",
        label: "Clear stream cache + all provider memory",
        detail: "Nuclear option — cached URLs plus all global and per-show failure memory",
      },
      { value: false, label: "Cancel" },
    ],
  });

  if (choice === "provider-memory") {
    return handleResetProviderHealth(container);
  }

  if (choice === "episode" && title && episode) {
    const { purgeEpisodePlaybackCache } = await import("@/app/playback/playback-cache-purge");
    await purgeEpisodePlaybackCache(container, title, episode);
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Stream cache cleared for ${title.name} ${episodeCode ?? ""}.`.trim(),
    });
    return "handled";
  }
  if (choice === "title" && title) {
    const { purgeTitlePlaybackCaches } = await import("@/app/playback/playback-cache-purge");
    await purgeTitlePlaybackCaches(container, title, episode ? [episode] : undefined);
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Stream cache cleared for ${title.name}.`,
    });
    return "handled";
  }
  if (choice === "streams") {
    await container.cacheStore.clear();
    container.diagnosticsService.record({ category: "cache", message: "Stream cache cleared" });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Entire stream cache cleared. Provider failure memory was not changed.",
    });
    return "handled";
  }
  if (choice === "all") {
    await container.cacheStore.clear();
    container.providerHealth.clearAll();
    container.titleProviderHealth.clearAll();
    container.diagnosticsService.record({
      category: "cache",
      message: "Stream cache and provider memory cleared",
    });
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Stream cache and all provider failure memory cleared.",
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
    container.historyRepository.clear();
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
  const { getPendingRestartVersion } = await import("@/services/update/BinaryAutoUpdater");
  const { getInstallDiagnostics } = await import("@/services/update/native-installer");
  const { readInstallManifest } = await import("@/services/update/install-manifest");

  const manifest = await readInstallManifest();
  const channel = manifest?.channel ?? "unknown";
  const config = container.config.getRaw();

  const updateCheck = await container.updateService.checkForUpdate({ force: true });

  if (channel === "binary" && config.autoApplyBinaryUpdates) {
    await container.binaryAutoUpdater.runOnce({ force: true });
  }

  const pending = await getPendingRestartVersion(updateCheck.currentVersion);
  const diagnostics = await getInstallDiagnostics();
  const diagText = diagnostics
    .filter((d) => d.code !== "ok")
    .map((d) => d.message)
    .join(" · ");

  let status: string;
  if (pending) {
    status = `Kunai ${pending} is ready on disk. Restart to use it (running ${updateCheck.currentVersion}).`;
  } else if (updateCheck.status === "update-available") {
    status = `Kunai ${updateCheck.latestVersion} is available. Current ${updateCheck.currentVersion}.`;
  } else if (updateCheck.status === "up-to-date") {
    status = `Kunai is up to date (${updateCheck.currentVersion}).`;
  } else if (updateCheck.status === "error") {
    status = `Update check failed: ${updateCheck.error ?? "unknown error"}`;
  } else {
    status = `Update checks are ${updateCheck.status}.`;
  }

  const subtitle = [status, updateCheck.guidance, diagText].filter(Boolean).join("  ·  ");
  const autoApply = config.autoApplyBinaryUpdates;

  const choice = await chooseFromListShell({
    title: "Update",
    subtitle,
    options: [
      {
        value: "snooze" as const,
        label: "Snooze update checks for 7 days",
        detail: "Mute automatic update notices temporarily",
      },
      {
        value: "toggle-auto" as const,
        label: autoApply ? "Disable background binary updates" : "Enable background binary updates",
        detail: autoApply
          ? "Stop downloading updates automatically (binary installs)"
          : "Download binary updates in the background",
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
  } else if (choice === "toggle-auto") {
    await container.binaryAutoUpdater.setAutoApply(!autoApply);
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
      selectedQualityLabel: resolveDownloadQualityCeiling(
        container.config.defaultDownloadQuality,
        state.mode === "anime"
          ? state.animeLanguageProfile.quality
          : state.currentTitle.type === "movie"
            ? state.movieLanguageProfile.quality
            : state.seriesLanguageProfile.quality,
        getSelectedPlaybackQualityLabel(state.stream),
      ),
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
  const { DownloadOnlyPhase } = await import("@/app/playback/DownloadOnlyPhase");
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

  const { openListShell } = await import("../ink-shell");
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

/** Copy a shareable kunai:// link for the current title (+episode) to the clipboard. */
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
  const mode = state.mode;
  const mediaKind = resolveCurrentMediaKind(state);
  const progress =
    episode &&
    container.historyRepository.getProgress(
      {
        id: title.id,
        kind: mediaKind,
        title: title.name,
        externalIds: title.externalIds,
      },
      { season: episode.season, episode: episode.episode },
    );
  const resumeSeconds =
    progress && progress.positionSeconds > 0 ? Math.floor(progress.positionSeconds) : undefined;

  let startSeconds: number | undefined;
  if (resumeSeconds && resumeSeconds > 10) {
    const choice = await chooseFromListShell({
      title: "Copy share link",
      subtitle: title.name,
      options: [
        { value: "start" as const, label: "Copy link from start" },
        {
          value: "resume" as const,
          label: `Copy link at ${formatTimestamp(resumeSeconds)}`,
        },
      ],
    });
    if (!choice) return "handled";
    startSeconds = choice === "resume" ? resumeSeconds : undefined;
  }

  const ref = buildShareRefFromTitleContext({
    title,
    mode,
    episode: episode ? { season: episode.season, episode: episode.episode } : undefined,
    startSeconds,
    providerId: state.provider,
  });
  if (!ref) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Could not build a share link for this title.",
    });
    return "handled";
  }
  const url = encodePlaybackTargetRef(ref);
  const copied = await copyToClipboard(url);
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: copied
      ? `Share link for "${title.name}" copied — open with kunai open or /watch.`
      : `Share link (copy manually): ${url}`,
  });
  return "handled";
}

async function handleBookmark(container: Container): Promise<"handled"> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  if (!title) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Play or select a title before bookmarking it.",
    });
    return "handled";
  }

  const episode = state.currentEpisode;
  const result = container.listService.toggleWatchlist({
    titleId: title.id,
    mediaKind: resolveCurrentMediaKind(state),
    title: title.name,
    season: episode?.season,
    episode: episode?.episode,
  });

  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note:
      result === "added"
        ? `Bookmarked "${title.name}" in your watchlist.`
        : `Removed "${title.name}" from your watchlist.`,
  });
  return "handled";
}

async function handleAttentionPreference(
  container: Container,
  preference: "implicit" | "following" | "muted",
): Promise<"handled"> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  if (!title) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note:
        preference === "following"
          ? "Play or select a title before following releases."
          : preference === "implicit"
            ? "Play or select a title before unfollowing releases."
            : "Play or select a title before muting releases.",
    });
    return "handled";
  }

  const result = await createContainerMediaActionRouter(container).run({
    actionId:
      preference === "following" ? "follow" : preference === "implicit" ? "unfollow" : "mute",
    item: {
      mediaKind: resolveCurrentMediaKind(state),
      titleId: title.id,
      title: title.name,
      season: state.currentEpisode?.season,
      episode: state.currentEpisode?.episode,
    },
    source: "shell-action",
  });
  if (result.status === "unsupported") {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: result.reason,
    });
    return "handled";
  }

  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note:
      preference === "following"
        ? `Following future releases for "${title.name}".`
        : preference === "implicit"
          ? `Stopped explicit release tracking for "${title.name}".`
          : `Muted future release notices for "${title.name}".`,
  });
  return "handled";
}

async function handleMarkWatched(container: Container): Promise<"handled"> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  if (!title) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Play or select a title before marking it watched.",
    });
    return "handled";
  }

  const episode = title.type === "series" ? state.currentEpisode : null;
  const mediaKind = resolveCurrentMediaKind(state);
  const titleIdentity = {
    id: title.id,
    kind: mediaKind,
    title: title.name,
    externalIds: title.externalIds,
  };
  const episodeIdentity = episode
    ? {
        season: episode.season,
        episode: episode.episode,
        externalIds: episode.externalIds,
      }
    : undefined;
  container.historyRepository.markWatched(titleIdentity, episodeIdentity);

  const episodeLabel = episode
    ? ` S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`
    : "";
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Marked "${title.name}${episodeLabel}" as watched.`,
  });
  return "handled";
}

async function handleMarkUnwatched(container: Container): Promise<"handled"> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  if (!title) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Play or select a title before marking it unwatched.",
    });
    return "handled";
  }

  const episode = title.type === "series" ? state.currentEpisode : null;
  const mediaKind = resolveCurrentMediaKind(state);
  const titleIdentity = {
    id: title.id,
    kind: mediaKind,
    title: title.name,
    externalIds: title.externalIds,
  };
  const episodeIdentity = episode
    ? { season: episode.season, episode: episode.episode, externalIds: episode.externalIds }
    : undefined;

  container.historyRepository.markUnwatched(titleIdentity, episodeIdentity);

  const episodeLabel = episode
    ? ` S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`
    : "";
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Marked "${title.name}${episodeLabel}" as unwatched (resume position kept).`,
  });
  return "handled";
}

async function handleMarkSeasonWatched(container: Container): Promise<"handled"> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const episode = state.currentEpisode;
  if (!title || title.type !== "series" || !episode) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Select a series episode before marking a season watched.",
    });
    return "handled";
  }

  const mediaKind = resolveCurrentMediaKind(state);
  const titleIdentity = {
    id: title.id,
    kind: mediaKind,
    title: title.name,
    externalIds: title.externalIds,
  };
  const { markSeasonThroughEpisode } = await import("@/app/search/history-actions");
  const count = markSeasonThroughEpisode(
    container.historyRepository,
    titleIdentity,
    episode.season,
    episode.episode,
  );

  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Marked ${count} episode(s) in season ${episode.season} through E${episode.episode} as watched.`,
  });
  return "handled";
}

async function handleMarkUpToEpisode(container: Container): Promise<"handled"> {
  const state = container.stateManager.getState();
  const title = state.currentTitle;
  const currentEpisode = state.currentEpisode;
  if (!title || title.type !== "series" || !currentEpisode) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Select a series episode before marking through an episode.",
    });
    return "handled";
  }

  const seasonEpisodes = await resolveSeasonEpisodesForQueue(container, title, currentEpisode);
  if (!seasonEpisodes?.length) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Could not load episodes for this season.",
    });
    return "handled";
  }

  const throughEpisode = await chooseFromListShell({
    title: "Mark through episode",
    subtitle: `${title.name} · Season ${currentEpisode.season}`,
    options: seasonEpisodes.map((episode) => ({
      value: episode.episode,
      label: `E${String(episode.episode).padStart(2, "0")}${episode.name ? ` · ${episode.name}` : ""}`,
      detail: `Mark episodes 1–${episode.episode} as watched`,
    })),
  });
  if (!throughEpisode) return "handled";

  const mediaKind = resolveCurrentMediaKind(state);
  const titleIdentity = {
    id: title.id,
    kind: mediaKind,
    title: title.name,
    externalIds: title.externalIds,
  };
  const { markSeasonThroughEpisode } = await import("@/app/search/history-actions");
  const count = markSeasonThroughEpisode(
    container.historyRepository,
    titleIdentity,
    currentEpisode.season,
    throughEpisode,
  );

  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Marked ${count} episode(s) in season ${currentEpisode.season} through E${throughEpisode} as watched.`,
  });
  return "handled";
}

function resolveCurrentMediaKind(state: SessionState): MediaKind {
  const title = state.currentTitle;
  if (title?.type === "movie") return "movie";
  return state.mode === "anime" || title?.isAnime === true ? "anime" : "series";
}

/** Open a kunai:// share link from the clipboard. */
async function handleWatch(container: Container): Promise<ShellWorkflowResult> {
  const clip = await readClipboard();
  const ref = clip ? parsePlaybackTargetRef(clip) : null;
  if (!ref) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "No Kunai share link on the clipboard. Copy a kunai:// link, then run /watch.",
    });
    return "handled";
  }
  const resolved = await resolveShareTarget(ref, container);
  if (resolved.note) {
    container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note: resolved.note });
  }
  if (resolved.searchQuery) {
    container.stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: resolved.searchQuery });
    if (resolved.mode === "anime") {
      container.stateManager.dispatch({
        type: "SET_MODE",
        mode: "anime",
        provider: container.config.animeProvider,
      });
    }
    return "handled";
  }
  return {
    type: "history-entry",
    title: resolved.title,
    episode: resolved.episode,
    ...(resolved.startSeconds !== undefined ? { startSeconds: resolved.startSeconds } : {}),
  };
}

async function handleWatchlist(container: Container): Promise<"handled"> {
  const { listService, historyRepository, releaseProgressCache } = container;
  const actionContext = buildPickerActionContext({ container, taskLabel: "Watchlist" });

  while (true) {
    const items = listService.getWatchlist();

    // Build per-title progress from history
    const progressMap = new Map<string, string>();
    const nextEpisodeMap = new Map<string, string>();
    const newEpisodeMap = new Map<string, number>();
    const history = readLatestHistoryByTitle(historyRepository);
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

    const attentionPreference = container.followedTitleRepository.get(picked.titleId)?.preference;
    const isMuted = attentionPreference === "muted";
    const isFollowing = attentionPreference === "following";

    type SubAction = "search" | "follow" | "unfollow" | "mute" | "remove" | "back";

    const sub = await chooseFromListShell({
      title: picked.title,
      subtitle: [
        "Watchlist title",
        isMuted ? "muted" : isFollowing ? "following releases" : "not following releases",
      ].join("  ·  "),
      actionContext,
      options: [
        {
          value: "search" as SubAction,
          label: "Open in search",
          detail: "Search for this title to play it",
        },
        ...(isFollowing
          ? [
              {
                value: "unfollow" as SubAction,
                label: "Unfollow releases",
                detail: "Return to neutral release attention without removing from Watchlist",
              },
            ]
          : isMuted
            ? [
                {
                  value: "unfollow" as SubAction,
                  label: "Unmute release notices",
                  detail: "Stop suppressing release nudges for this title",
                },
              ]
            : [
                {
                  value: "follow" as SubAction,
                  label: "Follow releases",
                  detail: "Surface new episodes in Calendar, Home, and notifications",
                },
              ]),
        ...(!isFollowing && !isMuted
          ? [
              {
                value: "mute" as SubAction,
                label: "Mute release notices",
                detail: "Keep it in Watchlist, but stop new-episode nudges",
              },
            ]
          : isFollowing
            ? [
                {
                  value: "mute" as SubAction,
                  label: "Mute release notices",
                  detail: "Suppress release nudges while keeping Watchlist saved",
                },
              ]
            : []),
        { value: "remove" as SubAction, label: "Remove from watchlist" },
        { value: "back" as SubAction, label: "Back" },
      ],
    });

    if (!sub || sub === "back") continue;

    if (sub === "search") {
      container.stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: picked.title });
      return "handled";
    }

    if (sub === "follow" || sub === "mute" || sub === "unfollow") {
      const pickedItem = items.find((item) => item.titleId === picked.titleId);
      const actionId = sub === "follow" ? "follow" : sub === "mute" ? "mute" : "unfollow";
      const result = await createContainerMediaActionRouter(container).run({
        actionId,
        item: {
          mediaKind: pickedItem?.mediaKind ?? "series",
          titleId: picked.titleId,
          title: picked.title,
        },
        source: "watchlist",
      });
      if (result.status === "unsupported") {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: result.reason,
        });
        continue;
      }
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          sub === "follow"
            ? `Following future releases for "${picked.title}".`
            : sub === "mute"
              ? `Muted future release notices for "${picked.title}".`
              : isMuted
                ? `Unmuted release notices for "${picked.title}".`
                : `Stopped following future releases for "${picked.title}".`,
      });
      continue;
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

// ─── Playlists ─────────────────────────────────────────────────────────────────

async function handlePlaylists(container: Container): Promise<ShellWorkflowResult> {
  const { durablePlaylistService, queueService } = container;
  const actionContext = buildPickerActionContext({ container, taskLabel: "Playlists" });

  while (true) {
    const playlists = durablePlaylistService.listPlaylists();

    type PlaylistAction =
      | { type: "playlist"; id: string; name: string }
      | { type: "create" }
      | { type: "export" }
      | { type: "import" }
      | { type: "up-next" }
      | { type: "back" };
    const options: ShellOption<PlaylistAction>[] = [
      ...playlists.map((playlist) => ({
        value: { type: "playlist" as const, id: playlist.id, name: playlist.name },
        label: playlist.name,
        detail: playlist.description,
      })),
      { value: { type: "create" as const }, label: "Create empty playlist" },
      ...(container.featureFlags.playlistSharing
        ? [
            {
              value: { type: "export" as const },
              label: "Export playlist",
              detail: "Write a safe Kunai playlist JSON file",
            },
            {
              value: { type: "import" as const },
              label: "Import playlist",
              detail: "Read a Kunai playlist JSON file from the exchange folder",
            },
          ]
        : []),
      {
        value: { type: "up-next" as const },
        label: "Open Up Next",
        detail: "Manage the current playback order",
      },
      { value: { type: "back" as const }, label: "Back" },
    ];

    const picked = await chooseFromListShell({
      title: "Playlists",
      subtitle:
        playlists.length > 0
          ? `${playlists.length} saved playlist${playlists.length === 1 ? "" : "s"}`
          : "No saved playlists yet. Save Up Next as a playlist to start.",
      actionContext,
      options,
    });

    if (!picked || picked.type === "back") return "handled";

    if (picked.type === "up-next") {
      return handleUpNext(container);
    }

    if (picked.type === "create") {
      const playlist = durablePlaylistService.createPlaylist(
        `Playlist ${new Date().toISOString().slice(0, 10)}`,
      );
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Created playlist "${playlist.name}".`,
      });
      continue;
    }

    if (picked.type === "export") {
      await exportDurablePlaylist(container, actionContext);
      continue;
    }

    if (picked.type === "import") {
      await importDurablePlaylist(container, actionContext);
      continue;
    }

    const itemAction = await chooseFromListShell({
      title: picked.name,
      subtitle: "Saved playlist",
      actionContext,
      options: [
        {
          value: "load" as const,
          label: "Load into Up Next",
          detail: "Append playlist items without autoplaying",
        },
        {
          value: "rename" as const,
          label: "Rename playlist",
        },
        {
          value: "delete" as const,
          label: "Delete playlist",
          detail: "Remove this durable playlist and its saved items",
        },
        { value: "export" as const, label: "Export playlist" },
        { value: "back" as const, label: "Back" },
      ],
    });

    if (itemAction === "load") {
      const loaded = durablePlaylistService.loadIntoQueue(queueService, picked.id);
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          loaded > 0
            ? `Loaded ${loaded} item(s) from "${picked.name}" into Up Next.`
            : "Selected playlist is empty.",
      });
    } else if (itemAction === "rename") {
      const nextName = `Playlist ${new Date().toISOString().slice(0, 10)}`;
      const renamed = durablePlaylistService.renamePlaylist(picked.id, nextName);
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Renamed playlist to "${renamed.name}".`,
      });
    } else if (itemAction === "delete") {
      const confirm = await chooseFromListShell({
        title: `Delete "${picked.name}"?`,
        subtitle: "This removes the durable playlist only, not Watchlist or Up Next.",
        actionContext,
        options: [
          { value: true, label: "Delete playlist" },
          { value: false, label: "Keep playlist" },
        ],
      });
      if (confirm) {
        durablePlaylistService.deletePlaylist(picked.id);
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: `Deleted playlist "${picked.name}".`,
        });
      }
    } else if (itemAction === "export") {
      await exportDurablePlaylist(container, actionContext);
    }
  }
}

// ─── Up Next ───────────────────────────────────────────────────────────────────

async function handleUpNext(container: Container): Promise<ShellWorkflowResult> {
  const { queueService, listService } = container;
  const actionContext = buildPickerActionContext({ container, taskLabel: "Up Next" });

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
      | { type: "load-durable" }
      | { type: "back" };

    const staleNote =
      status.isStale && status.lastActivityAt
        ? `  ·  last active ${describeStaleness(status.lastActivityAt)}`
        : "";

    const subtitle =
      all.length > 0
        ? `${status.unplayedCount} up next · ${all.length - status.unplayedCount} played${staleNote}`
        : "Up Next is empty. Add titles via /playlist-add or refill from Watchlist.";

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
        ? [{ value: { type: "clear-all" as const }, label: "Clear entire queue" }]
        : []),
      ...(all.length > 0
        ? [
            {
              value: { type: "snapshot-queue" as const },
              label: "Save Up Next as playlist",
              detail: "Create a durable playlist from the current Up Next identities",
            },
          ]
        : []),
      // Import/export are the "sharing" surface — gated behind the playlistSharing
      // feature flag so the playlist exchange folder I/O only appears when enabled.
      ...(container.featureFlags.playlistSharing
        ? [
            {
              value: { type: "export-durable" as const },
              label: "Export playlist",
              detail: "Write a safe Kunai playlist JSON file",
            },
            {
              value: { type: "import-durable" as const },
              label: "Import playlist",
              detail: "Read a Kunai playlist JSON file from the playlist exchange folder",
            },
          ]
        : []),
      { value: { type: "refill" as const }, label: "Refill from watchlist" },
      {
        value: { type: "load-durable" as const },
        label: "Play saved playlist",
        detail: "Load a durable playlist into Up Next",
      },
      { value: { type: "back" as const }, label: "Back" },
    ];

    const picked = await chooseFromListShell({
      title: `Up Next · ${status.unplayedCount} queued`,
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
        "Saved from Up Next",
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
        note: `Saved ${all.length} Up Next item(s) to "${playlist.name}".`,
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

    if (picked.type === "load-durable") {
      const playlists = container.durablePlaylistService.listPlaylists();
      if (playlists.length === 0) {
        container.stateManager.dispatch({
          type: "SET_PLAYBACK_FEEDBACK",
          note: "No saved playlists yet. Save the queue as a durable playlist first.",
        });
        continue;
      }

      const selectedPlaylist = await chooseFromListShell({
        title: "Play Saved Playlist",
        subtitle: "Load playlist items into Up Next without autoplaying",
        actionContext,
        options: playlists.map((playlist) => ({
          value: playlist.id,
          label: playlist.name,
          detail: playlist.description,
        })),
      });
      if (!selectedPlaylist) continue;

      const loaded = container.durablePlaylistService.loadIntoQueue(queueService, selectedPlaylist);
      const playlist = playlists.find((item) => item.id === selectedPlaylist);
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note:
          loaded > 0
            ? `Loaded ${loaded} item(s) from "${playlist?.name ?? "playlist"}" into Up Next.`
            : "Selected playlist is empty.",
      });
      continue;
    }

    if (picked.type === "clear-played") {
      queueService.clearPlayed();
      continue;
    }

    if (picked.type === "clear-all") {
      const confirm = await chooseFromListShell({
        title: "Clear entire queue?",
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
      const allIndex = all.findIndex((item) => item.id === picked.id);
      const canMoveUp = allIndex > 0;
      const canMoveDown = allIndex >= 0 && allIndex < all.length - 1;
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
        queueService.moveUpInQueue(picked.id);
        continue;
      } else if (itemAction === "move-down") {
        queueService.moveDownInQueue(picked.id);
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
      note: "No current title to add to queue.",
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
    note: `Added "${title.name}" to queue.`,
  });
  return "handled";
}

async function handleQueueSeason(container: Container): Promise<"handled"> {
  const { stateManager, queueService } = container;
  const state = stateManager.getState();
  const title = state.currentTitle;
  const currentEpisode = state.currentEpisode;

  if (!title || title.type !== "series" || !currentEpisode) {
    stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Select a series episode before queueing the rest of the season.",
    });
    return "handled";
  }

  const seasonEpisodes = await resolveSeasonEpisodesForQueue(container, title, currentEpisode);
  const plan = planEpisodeQueue({
    scope: { type: "current-season-remaining" },
    currentEpisode,
    seasonEpisodes,
  });

  if (plan.episodes.length === 0) {
    stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "No remaining episodes in this season to queue.",
    });
    return "handled";
  }

  const mediaKind = resolveCurrentMediaKind(state);
  for (const episode of plan.episodes) {
    queueService.enqueue({
      title: title.name,
      mediaKind,
      titleId: title.id,
      season: episode.season,
      episode: episode.episode,
      source: "queue-season",
    });
  }

  stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Queued ${plan.episodes.length} episode(s) from season ${currentEpisode.season}.`,
  });
  return "handled";
}

async function resolveSeasonEpisodesForQueue(
  container: Container,
  title: TitleInfo,
  currentEpisode: PlaybackEpisodeInfo,
): Promise<readonly PlaybackEpisodeInfo[] | null> {
  const state = container.stateManager.getState();
  if (state.mode === "anime") {
    const provider = container.providerRegistry.get(state.provider);
    if (!provider?.listEpisodes) return null;
    const episodes = await provider.listEpisodes({ title });
    if (!episodes?.length) return null;
    return [...episodes]
      .sort((left, right) => left.index - right.index)
      .map((episode) => ({
        season: currentEpisode.season,
        episode: episode.index,
        name: episode.name,
      }));
  }

  const episodes = await fetchEpisodes(title.id, currentEpisode.season);
  if (!episodes) return null;
  return episodes.map((episode) => ({
    season: currentEpisode.season,
    episode: episode.number,
    name: episode.name,
    airDate: episode.airDate,
    overview: episode.overview,
  }));
}

// ─── Stats ──────────────────────────────────────────────────────────────────────

async function handleStats(container: Container): Promise<"handled"> {
  const { openStatsShell } = await import("../ink-shell");
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
