import { dirname, join } from "node:path";

import {
  chooseEpisodeFromOptions,
  chooseFromListShell,
  chooseSeasonFromOptions,
  type ListShellActionContext,
  type ShellOption,
} from "@/app-shell/pickers";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import { chooseSearchResultTitle } from "@/app/browse-option-mappers";
import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";
import { createContinuationEngine } from "@/domain/continuation/ContinuationEngine";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import { createSourceSelectionEngine } from "@/domain/playback-source/SourceSelectionEngine";
import type { LocalSourceStatus } from "@/domain/playback-source/SourceSelectionEngine";
import type { EpisodePickerOption, TitleInfo } from "@/domain/types";
import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { revealPathInOsFileManager } from "@/infra/os/reveal-in-file-manager";
import { pruneOldDiagnosticFiles } from "@/services/diagnostics/retention";
import { DownloadEnqueueRejectedError } from "@/services/download/DownloadService";
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
  type HistoryEntry,
  type HistoryStore,
} from "@/services/persistence/HistoryStore";
import { fetchEpisodes, fetchSeasons, type EpisodeInfo } from "@/tmdb";
import { getKunaiPaths, type DownloadJobRecord } from "@kunai/storage";

import { resolveCommands } from "./commands";
import { openSessionPicker } from "./session-picker";
import type { ShellAction } from "./types";

export function localSourceStatusFromArtifactStatus(status: string): LocalSourceStatus {
  if (status === "ready") return "ready";
  if (status === "missing") return "missing-file";
  if (status === "invalid-file") return "invalid-file";
  return "none";
}

export async function playCompletedDownload(container: Container, jobId: string): Promise<void> {
  const playable = await container.offlineLibraryService.getPlayableSource(jobId);
  if (playable.status !== "ready") {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Offline file unavailable: ${playable.status}. Check integrity first.`,
    });
    return;
  }
  const decision = createSourceSelectionEngine().decide({
    entrypoint: "offline-library",
    local: { status: "ready", jobId },
    networkAvailable: true,
    preference: "prefer-local",
  });
  container.diagnosticsStore.record({
    category: "playback",
    message: "Offline source selected (unified play)",
    context: {
      jobId,
      sourceDecision: decision.reason,
      shouldResolveOnline: decision.shouldResolveOnline,
    },
  });
  const result = await container.player.playLocal({
    source: playable.source,
    attach: false,
    policy: {
      autoSkipEnabled: !container.stateManager.getState().autoskipSessionPaused,
      skipRecap: container.config.skipRecap,
      skipIntro: container.config.skipIntro,
      skipPreview: container.config.skipPreview,
      skipCredits: container.config.skipCredits,
    },
  });
  await container.offlineLibraryService.savePlaybackHistory(playable.source, result);
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
  | { type: "entry"; id: string; title: string }
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

export type SetupWizardResult = "completed" | "cancelled" | "skipped";

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

function packageInstallHint(pkg: "mpv" | "yt-dlp" | "chafa" | "imagemagick" | "ffprobe"): string {
  if (pkg === "ffprobe") {
    return "Put ffprobe on your PATH via your distro, a static build, or another package manager build that ships the ffprobe binary";
  }
  if (process.platform === "darwin") {
    return `brew install ${pkg}`;
  }
  if (process.platform === "linux") {
    return `sudo pacman -S ${pkg}  ·  or  sudo apt install ${pkg}`;
  }
  if (process.platform === "win32") {
    if (pkg === "chafa") return "winget install hpjansson.Chafa";
    if (pkg === "imagemagick") return "winget install ImageMagick.ImageMagick";
    if (pkg === "yt-dlp") return "winget install yt-dlp";
  }
  return `${pkg}: install via your system package manager`;
}

export async function runSetupWizard({
  container,
  force = false,
}: {
  container: Container;
  force?: boolean;
}): Promise<SetupWizardResult> {
  const current = container.config.getRaw();
  const needsOnboarding = current.onboardingVersion < 1 || !current.downloadOnboardingDismissed;
  if (!force && !needsOnboarding) {
    return "skipped";
  }

  const setupStepTitle = (step: number, title: string) => `[${step}/6] ${title}`;
  const defaultDownloadPath = join(dirname(getKunaiPaths().dataDbPath), "downloads");
  const capabilitySnapshot = container.capabilitySnapshot;
  const ffprobeAvailable = capabilitySnapshot?.ffprobe ?? Boolean(Bun.which("ffprobe"));
  const ytDlpAvailable = capabilitySnapshot?.ytDlp ?? Boolean(Bun.which("yt-dlp"));
  const chafaAvailable = capabilitySnapshot?.chafa ?? Boolean(Bun.which("chafa"));
  const magickAvailable = capabilitySnapshot?.magick ?? Boolean(Bun.which("magick"));
  const imageCapability = capabilitySnapshot?.image;
  const postersAvailable = imageCapability?.available ?? false;
  const posterDetail = imageCapability
    ? `${imageCapability.renderer} (${imageCapability.terminal})`
    : "off";
  const capabilityCard = [
    `mpv ${capabilitySnapshot?.mpv ? "ready" : "missing"}`,
    `yt-dlp ${ytDlpAvailable ? "ready" : "missing"}`,
    `ffprobe ${ffprobeAvailable ? "ready" : "optional"} (artifact check)`,
    `posters ${postersAvailable ? posterDetail : "off"}`,
    `chafa ${chafaAvailable ? "ready" : "optional"}`,
    `magick ${magickAvailable ? "ready" : "optional"}`,
  ].join("  ·  ");

  const startChoice = await chooseFromListShell({
    title: setupStepTitle(1, "Setup Wizard"),
    subtitle: `Configure downloads and offline defaults without leaving the TUI  ·  ${capabilityCard}`,
    options: [
      {
        value: "continue" as const,
        label: "Continue guided setup",
        detail: "We will configure downloads, pick a save path, and store onboarding preferences",
      },
      {
        value: "skip" as const,
        label: "Skip for now",
        detail: "Keep default behavior and continue straight to search",
      },
    ],
  });

  if (!startChoice || startChoice === "skip") {
    await container.config.update({
      onboardingVersion: 1,
      downloadOnboardingDismissed: true,
    });
    await container.config.save();
    container.diagnosticsStore.record({
      category: "session",
      message: "Setup wizard skipped",
      context: { force },
    });
    return startChoice ? "skipped" : "cancelled";
  }

  while (true) {
    const dependencyReview = await chooseFromListShell({
      title: setupStepTitle(2, "Dependency Guide"),
      subtitle:
        capabilitySnapshot?.mpv === false
          ? "mpv is missing and required. Install it, then rerun Kunai. Other items are optional."
          : "Kunai works with mpv only. Downloads and richer posters are optional add-ons.",
      options: [
        {
          value: "mpv" as const,
          label: capabilitySnapshot?.mpv ? "mpv detected (required)" : "Install mpv (required)",
          detail: packageInstallHint("mpv"),
        },
        {
          value: "yt-dlp" as const,
          label: ytDlpAvailable
            ? "yt-dlp detected (download engine ready)"
            : "Install yt-dlp for offline downloads",
          detail: packageInstallHint("yt-dlp"),
        },
        {
          value: "ffprobe" as const,
          label: ffprobeAvailable
            ? "ffprobe detected (optional download validation)"
            : "Install ffprobe for optional post-download validation",
          detail: packageInstallHint("ffprobe"),
        },
        {
          value: "chafa" as const,
          label: chafaAvailable
            ? "chafa detected (poster previews ready)"
            : "Install chafa for poster previews",
          detail: packageInstallHint("chafa"),
        },
        {
          value: "magick" as const,
          label: magickAvailable
            ? "ImageMagick detected (broader Kitty posters)"
            : "Install ImageMagick for broader Kitty posters",
          detail: packageInstallHint("imagemagick"),
        },
        {
          value: "continue" as const,
          label: "Continue setup",
          detail: "Apply download preferences and finish onboarding",
        },
      ],
    });

    if (!dependencyReview) {
      return "cancelled";
    }
    if (dependencyReview === "continue") {
      break;
    }
  }

  while (true) {
    const posterReview = await chooseFromListShell({
      title: setupStepTitle(3, "Poster Preview"),
      subtitle: postersAvailable
        ? `Poster previews are available via ${posterDetail}`
        : "Poster previews are currently unavailable. You can still use Kunai normally.",
      options: [
        {
          value: "status" as const,
          label: postersAvailable ? "Poster previews enabled" : "Poster previews unavailable",
          detail: imageCapability?.reason ?? "No compatible terminal protocol detected",
        },
        {
          value: "chafa" as const,
          label: chafaAvailable
            ? "chafa detected (Sixel/symbols ready)"
            : "Install chafa for Windows/WezTerm posters",
          detail: packageInstallHint("chafa"),
        },
        {
          value: "magick" as const,
          label: magickAvailable
            ? "ImageMagick detected (broader Kitty posters)"
            : "Install ImageMagick for broader Kitty posters",
          detail: packageInstallHint("imagemagick"),
        },
        {
          value: "env" as const,
          label: "Poster env overrides",
          detail: "KUNAI_POSTER=0  ·  KUNAI_IMAGE_PROTOCOL=auto|kitty|sixel|symbols|none",
        },
        {
          value: "continue" as const,
          label: "Continue setup",
          detail: "Proceed to download preferences",
        },
      ],
    });

    if (!posterReview) {
      return "cancelled";
    }
    if (posterReview === "continue") {
      break;
    }
  }

  const downloadChoice = await chooseFromListShell({
    title: setupStepTitle(4, "Offline Downloads"),
    subtitle: ytDlpAvailable
      ? "yt-dlp detected — download queue can run when downloads are enabled"
      : "yt-dlp not found — enable downloads in settings and install yt-dlp to use the queue",
    options: [
      {
        value: "enable" as const,
        label: "Enable downloads",
        detail: ytDlpAvailable
          ? "Queue downloads from browse or playback; manage jobs with /downloads"
          : "Save the preference now; install yt-dlp (optional ffprobe for validation) for full checks",
      },
      {
        value: "disable" as const,
        label: "Keep downloads disabled",
        detail: "You can rerun setup anytime with /setup from the command palette",
      },
    ],
  });

  if (!downloadChoice) {
    return "cancelled";
  }

  let downloadPath = current.downloadPath;
  const pathChoice = await chooseFromListShell({
    title: setupStepTitle(5, "Download Location"),
    subtitle:
      downloadChoice === "enable"
        ? `Current: ${current.downloadPath || defaultDownloadPath}`
        : "Downloads are disabled, so location setup is optional for now",
    options: [
      {
        value: "default" as const,
        label: "Use default Kunai path",
        detail: `${defaultDownloadPath}  ·  reliable fallback across sessions`,
      },
      {
        value: "keep" as const,
        label: "Keep current configured path",
        detail: current.downloadPath || "No custom path configured yet",
      },
      {
        value: "skip" as const,
        label: "Skip path setup",
        detail: "Keep current location without making changes",
      },
    ],
  });

  if (!pathChoice) {
    return "cancelled";
  }
  if (pathChoice === "default") {
    downloadPath = defaultDownloadPath;
  }
  if (pathChoice === "keep") {
    downloadPath = current.downloadPath;
  }

  await container.config.update({
    onboardingVersion: 1,
    downloadsEnabled: downloadChoice === "enable",
    downloadPath,
    downloadOnboardingDismissed: true,
  });
  await container.config.save();

  const finalDownloadPath =
    downloadChoice === "enable" ? downloadPath || defaultDownloadPath : "disabled";
  while (true) {
    const finalChoice = await chooseFromListShell({
      title: setupStepTitle(6, "Setup Complete"),
      subtitle: `Downloads ${downloadChoice === "enable" ? "enabled" : "disabled"}  ·  Path ${finalDownloadPath}  ·  Start with search, discover, random, or offline`,
      options: [
        {
          value: "tips-search" as const,
          label: "Search a title",
          detail: 'Type a title or launch with kunai -S "Dune"; Enter opens the selected result',
        },
        {
          value: "tips-discover" as const,
          label: "Discover and surprise",
          detail:
            "Use /discover for recommendations, /calendar for today, or /random for a non-autoplay tray",
        },
        {
          value: "tips-offline" as const,
          label: "Offline library",
          detail: "Use /offline or kunai --zen --offline to browse completed downloads locally",
        },
        {
          value: "tips-command" as const,
          label: "Command palette",
          detail: "Press / from anywhere; common actions are ordered by the current screen",
        },
        {
          value: "tips-recovery" as const,
          label: "Recovery is normal",
          detail:
            "Use /recover to refresh the current stream, /fallback for another provider, and /diagnostics for evidence",
        },
        {
          value: "tips-download" as const,
          label: "Download queue",
          detail:
            "Use /download while browsing or playing; /downloads manages jobs and /offline plays completed files",
        },
        {
          value: "tips-rerun" as const,
          label: "Rerun onboarding",
          detail: "/setup changes downloads, poster hints, and local defaults anytime",
        },
        {
          value: "tips-presence" as const,
          label: "Discord Presence",
          detail:
            "Use /presence to turn on Rich Presence when Discord desktop and IPC are available",
        },
        {
          value: "done" as const,
          label: "Start using Kunai",
          detail: "Jump into search and start watching",
        },
      ],
    });
    if (!finalChoice) {
      return "cancelled";
    }
    if (finalChoice === "done") {
      break;
    }
  }

  container.diagnosticsStore.record({
    category: "session",
    message: "Setup wizard completed",
    context: {
      downloadsEnabled: downloadChoice === "enable",
      downloadPath: downloadChoice === "enable" ? finalDownloadPath : null,
      ffprobeAvailable,
      ytDlpAvailable,
      force,
    },
  });

  return "completed";
}

function formatHistoryLabel(entry: HistoryEntry): string {
  const progress = entry.duration
    ? `${Math.round((entry.timestamp / entry.duration) * 100)}%`
    : formatTimestamp(entry.timestamp);
  return entry.type === "series"
    ? `${entry.title}  ·  S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}  ·  ${progress}`
    : `${entry.title}  ·  movie  ·  ${progress}`;
}

function formatHistoryDetail(entry: HistoryEntry): string {
  const watched = new Date(entry.watchedAt).toLocaleDateString();
  return `${watched}${isFinished(entry) ? "  ·  finished" : ""}  ·  provider ${entry.provider}`;
}

function summarizeHeaderKeys(headers: Record<string, string> | undefined): string {
  const keys = Object.keys(headers ?? {});
  return keys.length > 0 ? keys.join(", ") : "none";
}

function describeDownloadJob(job: DownloadJobRecord): string {
  return formatOfflineJobListingTitle(job);
}

async function openHistoryShell(
  historyStore: HistoryStore,
  actionContext?: ListShellActionContext,
): Promise<void> {
  while (true) {
    const entries = Object.entries(await historyStore.getAll()).sort(
      (a, b) =>
        (new Date(b[1].watchedAt).getTime() || 0) - (new Date(a[1].watchedAt).getTime() || 0),
    );

    const options: ShellOption<HistoryAction>[] = [
      ...entries.map(([id, entry]) => ({
        value: { type: "entry" as const, id, title: entry.title },
        label: formatHistoryLabel(entry),
        detail: formatHistoryDetail(entry),
      })),
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
          ? "Select an entry to remove it, or clear the full history"
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
    const historyEntries = await container.historyStore.listByTitle(first.titleId);
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
              history.season === entry.job.season &&
              history.episode === entry.job.episode &&
              isFinished(history),
          ),
        })),
    });
    const options: ShellOption<DownloadJobAction>[] = [
      ...entries.map((entry) => ({
        value: { type: "job" as const, id: entry.job.id },
        label: `${offlineStatusIcon(entry.status)} ${formatOfflineJobListingTitle(entry.job)}`,
        detail: `${formatOfflineShelfBadge(entry.job, entry.status)}  ·  ${formatOfflineShelfDetail(
          entry.job,
          entry.status,
        )}`,
        previewImageUrl: resolveOfflineJobPreviewImage(entry.job),
      })),
      ...buildOfflineGroupActions(entries, container.config.protectedDownloadJobIds),
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
      container.diagnosticsStore.record({
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
    if (picked.type === "search-online") {
      container.stateManager.dispatch({ type: "SET_SEARCH_QUERY", query: first.titleName });
      container.stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Search prepared for ${first.titleName}. Submit it to continue online.`,
      });
      container.diagnosticsStore.record({
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
    if (!job || job.status !== "completed") continue;

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
          label: "Re-download",
          detail: "Queue a fresh attempt from stored download intent",
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
        container.diagnosticsStore.record({
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
      container.diagnosticsStore.record({
        category: "download",
        message: "Offline artifact integrity checked",
        context: { jobId: job.id, artifactStatus: checkedStatus, outputPath: job.outputPath },
      });
      continue;
    }
    if (action === "retry") {
      container.downloadService.retry(job.id);
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `Re-download queued: ${formatOfflineJobListingTitle(job)}`,
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
  container.diagnosticsStore.record({
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

async function openIssueUrl(): Promise<void> {
  const url = "https://github.com/kitsunekode/kunai/issues/new/choose";
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
    onAction: (action) => handleShellAction({ action, container }),
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
    before.presenceDiscordClientId !== next.presenceDiscordClientId
  ) {
    await container.presence.disconnect("settings-changed");
  }
}

type ActionHandler = (container: Container) => Promise<"handled" | "quit" | "unhandled">;

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
};

export async function handleShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<"handled" | "quit" | "unhandled"> {
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
  const { stateManager, historyStore } = container;
  await withOverlay(stateManager, { type: "history" }, () =>
    openHistoryShell(
      historyStore,
      buildPickerActionContext({ container, taskLabel: "Manage history" }),
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
  const { stateManager, diagnosticsStore } = container;
  const state = stateManager.getState();
  const recentEvents = diagnosticsStore.getRecent(6);
  await withOverlay(stateManager, { type: "diagnostics" }, () =>
    openStaticInfoShell({
      title: "Diagnostics",
      subtitle: "Current shell state snapshot",
      lines: [
        { label: "Mode and provider", detail: `${state.mode}  ·  ${state.provider}` },
        { label: "View and playback", detail: `${state.view}  ·  ${state.playbackStatus}` },
        {
          label: "Subtitle state",
          detail: describePlaybackSubtitleStatus(
            state.stream,
            state.mode === "anime"
              ? state.animeLanguageProfile.subtitle
              : state.seriesLanguageProfile.subtitle,
          ),
        },
        {
          label: "Selected subtitle URL",
          detail: state.stream?.subtitle ?? "not found or disabled",
        },
        { label: "Subtitle tracks", detail: String(state.stream?.subtitleList?.length ?? 0) },
        { label: "Stream URL", detail: state.stream?.url ?? "not resolved yet" },
        { label: "Header keys", detail: summarizeHeaderKeys(state.stream?.headers) },
        {
          label: "Search state",
          detail: `${state.searchState}  ·  ${state.searchResults.length} results`,
        },
        { label: "Memory", detail: `RSS ${(process.memoryUsage().rss / 1_048_576).toFixed(1)} MB` },
        {
          label: "Startup capabilities",
          detail: container.capabilitySnapshot?.issues?.length
            ? container.capabilitySnapshot.issues
                .map((i) => `${String(i.id)} (${String(i.severity)})`)
                .join("  ·  ")
            : "no startup capability issues",
        },
        ...recentEvents.map((event) => ({
          label: `${new Date(event.timestamp).toLocaleTimeString()}  ·  ${event.category}`,
          detail: event.context
            ? `${event.message}  ·  ${JSON.stringify(event.context)}`
            : event.message,
        })),
      ],
    }),
  );
  return "handled";
}

async function handleProviderPicker(container: Container): Promise<"handled"> {
  const { stateManager, providerRegistry } = container;
  const state = stateManager.getState();
  const picked = await withOverlay(
    stateManager,
    { type: "provider_picker", currentProvider: state.provider, isAnime: state.mode === "anime" },
    () =>
      openProviderPicker({
        currentProvider: state.provider,
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
  if (picked && picked !== state.provider) {
    stateManager.dispatch({ type: "SET_PROVIDER", provider: picked });
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
  const confirm = await chooseFromListShell({
    title: "Clear stream cache?",
    subtitle: "This will remove all cached stream URLs.",
    options: [
      { value: true, label: "Yes, clear cache" },
      { value: false, label: "Cancel" },
    ],
  });
  if (confirm) {
    await container.cacheStore.clear();
    container.diagnosticsStore.record({ category: "cache", message: "Stream cache cleared" });
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
    container.diagnosticsStore.record({ category: "session", message: "Watch history cleared" });
  }
  return "handled";
}

async function handleExportDiagnostics(container: Container): Promise<"handled"> {
  const fileName = `kunai-diagnostics-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const path = join(process.cwd(), fileName);
  const bundle = container.diagnosticsService.buildSupportBundle({
    capabilities: container.capabilitySnapshot as unknown as Record<string, unknown> | null,
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
    context: { path: fileName },
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
    const bundle = container.diagnosticsService.buildSupportBundle({
      capabilities: container.capabilitySnapshot as unknown as Record<string, unknown> | null,
    });
    await writeAtomicJson(path, bundle);
    await pruneOldDiagnosticFiles({
      dir: process.cwd(),
      prefix: "kunai-diagnostics-report-",
      maxFiles: 10,
    });
    container.diagnosticsStore.record({
      category: "ui",
      message: "Diagnostics report bundle exported",
      context: { path: fileName },
    });
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
    container.diagnosticsStore.record({
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
          : state.seriesLanguageProfile.audio,
      subtitlePreference:
        state.mode === "anime"
          ? state.animeLanguageProfile.subtitle
          : state.seriesLanguageProfile.subtitle,
      timing,
    });
    container.diagnosticsStore.record({
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
    container.diagnosticsStore.record({
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
  const mapped = await mapAnimeDiscoveryResultToProviderNative(selected, {
    mode: state.mode,
    providerId: state.provider,
    animeLanguageProfile: container.config.animeLanguageProfile,
    providerRegistry,
    signal: new AbortController().signal,
  });
  const title: TitleInfo = {
    id: mapped.id,
    type: mapped.type,
    name: chooseSearchResultTitle(mapped, container.config.animeTitlePreference),
    titleAliases: mapped.titleAliases,
    year: mapped.year,
    overview: mapped.overview,
    posterUrl: mapped.posterPath ?? undefined,
    episodeCount: mapped.episodeCount,
  };
  const { DownloadOnlyPhase } = await import("@/app/DownloadOnlyPhase");
  await new DownloadOnlyPhase().execute(
    { title },
    { container, signal: new AbortController().signal },
  );
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

export async function openSourcePicker(
  entries: ReadonlyArray<{
    value: string;
    label: string;
    detail?: string;
  }>,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<string | null> {
  if (container) {
    return await openSessionPicker(container.stateManager, {
      type: "source_picker",
      options: entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
        detail: entry.detail,
      })),
    });
  }

  return chooseFromListShell({
    title: "Choose source",
    subtitle: `${entries.length} sources available`,
    actionContext,
    options: entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      detail: entry.detail,
    })),
  });
}

export async function openQualityPicker(
  entries: ReadonlyArray<{
    value: string;
    label: string;
    detail?: string;
  }>,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<string | null> {
  if (container) {
    return await openSessionPicker(container.stateManager, {
      type: "quality_picker",
      options: entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
        detail: entry.detail,
      })),
    });
  }

  return chooseFromListShell({
    title: "Choose quality",
    subtitle: `${entries.length} quality options available`,
    actionContext,
    options: entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      detail: entry.detail,
    })),
  });
}

export async function openSeasonPicker(
  tmdbId: string,
  currentSeason: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  const seasons = await fetchSeasons(tmdbId);
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
          value: "showMemory" as const,
          label: `Memory panel  ·  ${next.showMemory ? "opens on playback" : "on demand"}`,
          detail: "Press m during playback for fresh app, mpv, total, heap, and swap usage",
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
      if (historyStore) await openHistoryShell(historyStore, actionContext);
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
            detail: "Use optional local Discord Rich Presence when discord-rpc is installed",
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
