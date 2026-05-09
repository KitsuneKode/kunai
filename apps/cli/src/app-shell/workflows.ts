import { basename, dirname, join } from "node:path";

import { describeEpisodeWatchPresentation } from "@/app/playback-episode-picker";
import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";
import type { EpisodePickerOption } from "@/domain/types";
import { writeAtomicJson } from "@/infra/fs/atomic-write";
import { revealPathInOsFileManager } from "@/infra/os/reveal-in-file-manager";
import { DownloadEnqueueRejectedError } from "@/services/download/DownloadService";
import {
  formatOfflineJobListingTitle,
  formatOfflineSecondaryLine,
  hydrateCompletedOfflineJobs,
  offlineStatusIcon,
  parseIntroSkipTiming,
  resolveOfflineArtifactStatus,
} from "@/services/offline/offline-library";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  formatTimestamp,
  isFinished,
  type HistoryEntry,
  type HistoryStore,
} from "@/services/persistence/HistoryStore";
import { fetchEpisodes, fetchSeasons, type EpisodeInfo } from "@/tmdb";
import { getKunaiPaths } from "@kunai/storage";

import { resolveCommands, type ResolvedAppCommand } from "./commands";
import { openSessionPicker } from "./session-picker";
import type { ShellAction } from "./types";

type ListShellActionContext = {
  commands: readonly ResolvedAppCommand[];
  onAction: (
    action: ShellAction,
  ) => Promise<"handled" | "quit" | "unhandled"> | "handled" | "quit" | "unhandled";
  taskLabel?: string;
  footerMode?: "detailed" | "minimal";
};

type HistoryAction =
  | { type: "entry"; id: string; title: string }
  | { type: "clear-all" }
  | { type: "back" };

type DownloadJobAction = { type: "job"; id: string } | { type: "back" };
type DownloadJobFilter = "active" | "failed" | "completed" | "all";
type CompletedDownloadAction =
  | "play"
  | "reveal"
  | "retry"
  | "delete-job"
  | "delete-artifact"
  | "back";

type ShellOption<T> = {
  value: T;
  label: string;
  detail?: string;
};

export type SetupWizardResult = "completed" | "cancelled" | "skipped";

const SUBTITLE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "fzf", label: "Pick interactively" },
  { value: "none", label: "None" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "ja", label: "Japanese" },
] as const;

const ANIME_AUDIO_OPTIONS = [
  { value: "sub", label: "Sub", detail: "Original audio with subtitles" },
  { value: "dub", label: "Dub", detail: "Dubbed audio when available" },
] as const;

async function chooseOption<T>({
  title,
  subtitle,
  options,
  actionContext,
}: {
  title: string;
  subtitle: string;
  options: readonly ShellOption<T>[];
  actionContext?: ListShellActionContext;
}): Promise<T | null> {
  const { openListShell } = await import("./ink-shell");
  return openListShell({ title, subtitle, options, actionContext });
}

function packageInstallHint(pkg: "mpv" | "ffmpeg" | "chafa" | "imagemagick"): string {
  if (process.platform === "darwin") {
    return `brew install ${pkg}`;
  }
  if (process.platform === "linux") {
    return `sudo pacman -S ${pkg}  ·  or  sudo apt install ${pkg}`;
  }
  if (process.platform === "win32") {
    if (pkg === "chafa") return "winget install hpjansson.Chafa";
    if (pkg === "imagemagick") return "winget install ImageMagick.ImageMagick";
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
  const ffmpegAvailable = capabilitySnapshot?.ffmpeg ?? Boolean(Bun.which("ffmpeg"));
  const chafaAvailable = capabilitySnapshot?.chafa ?? Boolean(Bun.which("chafa"));
  const magickAvailable = capabilitySnapshot?.magick ?? Boolean(Bun.which("magick"));
  const imageCapability = capabilitySnapshot?.image;
  const postersAvailable = imageCapability?.available ?? false;
  const posterDetail = imageCapability
    ? `${imageCapability.renderer} (${imageCapability.terminal})`
    : "off";
  const capabilityCard = [
    `mpv ${capabilitySnapshot?.mpv ? "ready" : "missing"}`,
    `ffmpeg ${ffmpegAvailable ? "ready" : "missing"}`,
    `posters ${postersAvailable ? posterDetail : "off"}`,
    `chafa ${chafaAvailable ? "ready" : "optional"}`,
    `magick ${magickAvailable ? "ready" : "optional"}`,
  ].join("  ·  ");

  const startChoice = await chooseOption({
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
    const dependencyReview = await chooseOption({
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
          value: "ffmpeg" as const,
          label: ffmpegAvailable
            ? "ffmpeg detected (downloads ready)"
            : "Install ffmpeg for downloads",
          detail: packageInstallHint("ffmpeg"),
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
    const posterReview = await chooseOption({
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

  const downloadChoice = await chooseOption({
    title: setupStepTitle(4, "Offline Downloads"),
    subtitle: ffmpegAvailable
      ? "ffmpeg detected — download queue can run immediately"
      : "ffmpeg not found — playback still works; downloads stay disabled until ffmpeg is installed",
    options: [
      {
        value: "enable" as const,
        label: "Enable downloads",
        detail: ffmpegAvailable
          ? "Queue downloads from active playback and monitor status in-shell"
          : "Save the preference now; downloads become usable after ffmpeg is available",
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
  const pathChoice = await chooseOption({
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
    const finalChoice = await chooseOption({
      title: setupStepTitle(6, "Setup Complete"),
      subtitle: `Downloads ${downloadChoice === "enable" ? "enabled" : "disabled"}  ·  Path ${finalDownloadPath}`,
      options: [
        {
          value: "tips-command" as const,
          label: "/ command palette",
          detail: "Open global actions from anywhere in the TUI",
        },
        {
          value: "tips-recommendation" as const,
          label: "Ctrl+T refresh trending",
          detail: "Reload recommendation lists in browse mode",
        },
        {
          value: "tips-download" as const,
          label: "d queue download during playback",
          detail: "Use playback controls to queue offline jobs quickly",
        },
        {
          value: "tips-rerun" as const,
          label: "/setup reruns onboarding",
          detail: "Change onboarding decisions anytime",
        },
        {
          value: "tips-presence" as const,
          label: "Enable Discord Presence now",
          detail: "Use /presence to turn on Rich Presence (Discord desktop app required)",
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
      ffmpegAvailable,
      force,
    },
  });

  return "completed";
}

export async function chooseSeasonFromOptions(
  seasons: readonly number[],
  currentSeason: number,
  actionContext?: ListShellActionContext,
  container?: Container,
): Promise<number | null> {
  if (seasons.length === 0) return null;
  if (seasons.length === 1) return seasons[0] ?? currentSeason;

  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "season_picker",
      currentSeason,
      options: seasons.map((season) => ({
        value: String(season),
        label: season === currentSeason ? `Season ${season}  ·  current` : `Season ${season}`,
      })),
    });
    return picked ? Number.parseInt(picked, 10) : null;
  }

  return chooseOption({
    title: "Choose season",
    subtitle: `Current season ${currentSeason}`,
    actionContext,
    options: seasons.map((season) => ({
      value: season,
      label: season === currentSeason ? `Season ${season}  ·  current` : `Season ${season}`,
    })),
  });
}

export async function chooseEpisodeFromOptions(
  episodes: readonly EpisodeInfo[],
  season: number,
  currentEpisode: number,
  actionContext?: ListShellActionContext,
  container?: Container,
  titleId?: string,
): Promise<EpisodeInfo | null> {
  if (episodes.length === 0) return null;

  // Load per-episode watch status from history when context is available.
  const episodeStatus = await buildEpisodeStatusMap(container, titleId, season, episodes);

  let watchedSubtitle: string | null = null;
  if (episodeStatus.size > 0) {
    const finishedCount = [...episodeStatus.values()].filter((s) => s.tone === "success").length;
    if (finishedCount > 0) {
      watchedSubtitle = `${finishedCount}/${episodes.length} watched`;
    }
  }

  if (container) {
    const picked = await openSessionPicker(container.stateManager, {
      type: "episode_picker",
      season,
      initialIndex: Math.max(
        0,
        episodes.findIndex((episode) => episode.number === currentEpisode),
      ),
      options: episodes.map((episode) => {
        const status = episodeStatus.get(episode.number);
        return {
          value: String(episode.number),
          label: `Episode ${episode.number}  ·  ${episode.name}`,
          detail: episode.airDate || "unknown year",
          tone: status?.tone ?? (episode.number === currentEpisode ? "info" : undefined),
          badge: episode.number === currentEpisode ? "current" : status?.badge,
        };
      }),
    });
    if (!picked) return null;
    return episodes.find((episode) => String(episode.number) === picked) ?? null;
  }

  return chooseOption({
    title: "Choose episode",
    subtitle: `Season ${season}  ·  ${watchedSubtitle ?? `Current episode ${currentEpisode}`}`,
    actionContext,
    options: episodes.map((episode) => ({
      value: episode,
      label:
        episode.number === currentEpisode
          ? `Episode ${episode.number}  ·  ${episode.name}  ·  current`
          : `Episode ${episode.number}  ·  ${episode.name}`,
      detail: episode.airDate || "unknown year",
    })),
  });
}

type EpisodeStatusEntry = { tone: "success" | "warning"; badge: string };

async function buildEpisodeStatusMap(
  container: Container | undefined,
  titleId: string | undefined,
  season: number,
  episodes: readonly EpisodeInfo[],
): Promise<Map<number, EpisodeStatusEntry>> {
  const map = new Map<number, EpisodeStatusEntry>();
  if (!container || !titleId) return map;

  const allEntries = await container.historyStore.listByTitle(titleId);
  const seasonEntries = allEntries.filter((e) => e.season === season);
  if (seasonEntries.length === 0) return map;

  // Direct status from history — take most recent entry per episode.
  for (const entry of seasonEntries) {
    if (!map.has(entry.episode)) {
      if (isFinished(entry)) {
        const presentation = describeEpisodeWatchPresentation(entry);
        map.set(entry.episode, { tone: "success", badge: presentation.badge ?? "watched" });
      } else if (entry.timestamp > 0) {
        const presentation = describeEpisodeWatchPresentation(entry);
        map.set(entry.episode, {
          tone: "warning",
          badge: presentation.badge ?? "resume",
        });
      }
    }
  }

  // Mark episodes before the furthest-watched as implicitly finished.
  const maxWatched = Math.max(...seasonEntries.map((e) => e.episode));
  for (const ep of episodes) {
    if (ep.number < maxWatched && !map.has(ep.number)) {
      map.set(ep.number, { tone: "success", badge: "✓" });
    }
  }

  return map;
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

function describeDownloadJob(job: import("@kunai/storage").DownloadJobRecord): string {
  return formatOfflineJobListingTitle(job);
}

function detailDownloadJob(job: import("@kunai/storage").DownloadJobRecord): string {
  const parts = [
    `${statusDetail(job)}`,
    `${renderProgressBar(job.progressPercent)} ${job.progressPercent}%`,
    `attempt ${job.attempt}/${job.maxAttempts}`,
  ];
  if (job.nextRetryAt) parts.push(`retry ${formatRelativeRetry(job.nextRetryAt)}`);
  if (job.errorMessage) parts.push(job.errorMessage);
  return parts.join("  ·  ");
}

function statusDetail(job: import("@kunai/storage").DownloadJobRecord): string {
  if (job.status === "failed" && job.failureKind) {
    return `failed (${job.failureKind})`;
  }
  return job.status;
}

function formatRelativeRetry(nextRetryAt: string): string {
  const targetMs = Date.parse(nextRetryAt);
  if (!Number.isFinite(targetMs)) {
    return new Date(nextRetryAt).toLocaleTimeString();
  }
  const deltaMs = targetMs - Date.now();
  if (deltaMs <= 0) {
    return "now";
  }
  const seconds = Math.ceil(deltaMs / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return remSeconds > 0 ? `in ${minutes}m ${remSeconds}s` : `in ${minutes}m`;
}

function renderProgressBar(percentage: number): string {
  const totalBlocks = 10;
  const filledBlocks = Math.max(
    0,
    Math.min(totalBlocks, Math.round((percentage / 100) * totalBlocks)),
  );
  const emptyBlocks = totalBlocks - filledBlocks;
  return `[${"█".repeat(filledBlocks)}${"░".repeat(emptyBlocks)}]`;
}

function statusPrefix(job: import("@kunai/storage").DownloadJobRecord): string {
  if (job.status === "running") return "▶";
  if (job.status === "queued") return "●";
  if (job.status === "failed") return "!";
  if (job.status === "aborted") return "×";
  return "✓";
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

    const picked = await chooseOption({
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
      const confirm = await chooseOption({
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

    const confirm = await chooseOption({
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

async function openDownloadsShell(
  container: Container,
  actionContext?: ListShellActionContext,
): Promise<void> {
  let filter: DownloadJobFilter = "active";
  while (true) {
    const active = container.downloadService.listActive(100);
    const failed = container.downloadService.listFailed(100);
    const completed = container.downloadService.listCompleted(100).slice(0, 40);
    const filterChoice: DownloadJobFilter | "back" | null = await chooseOption<
      DownloadJobFilter | "back"
    >({
      title: "Download Jobs",
      subtitle: `${active.length} active  ·  ${failed.length} failed  ·  ${completed.length} completed`,
      actionContext,
      options: [
        {
          value: "active" as const,
          label: "Active queue",
          detail: "Running and queued jobs",
        },
        {
          value: "failed" as const,
          label: "Failed jobs",
          detail: "Retryable and terminal failures",
        },
        {
          value: "completed" as const,
          label: "Completed jobs",
          detail: "Latest finished artifacts",
        },
        {
          value: "all" as const,
          label: "All jobs",
          detail: "Combined queue view",
        },
        { value: "back" as const, label: "Back" },
      ],
    });
    if (!filterChoice || filterChoice === "back") {
      return;
    }
    filter = filterChoice;

    const visibleJobs =
      filter === "active"
        ? active
        : filter === "failed"
          ? failed
          : filter === "completed"
            ? completed
            : [...active, ...failed, ...completed];
    const options: ShellOption<DownloadJobAction>[] = [
      ...visibleJobs.map((job) => ({
        value: { type: "job" as const, id: job.id },
        label: `${statusPrefix(job)} ${describeDownloadJob(job)}`,
        detail:
          job.status === "completed"
            ? `${job.status}  ·  ${job.outputPath}`
            : detailDownloadJob(job),
      })),
      { value: { type: "back" as const }, label: "Back" },
    ];
    const picked = await chooseOption({
      title: "Download Jobs",
      subtitle:
        options.length > 1
          ? `${filter}  ·  ${options.length - 1} entries`
          : `${filter}  ·  no entries yet`,
      actionContext,
      options,
    });
    if (!picked || picked.type === "back") {
      return;
    }
    const job = [...active, ...failed, ...completed].find((entry) => entry.id === picked.id);
    if (!job) continue;

    if (job.status === "running" || job.status === "queued") {
      const action = await chooseOption({
        title: describeDownloadJob(job),
        subtitle: detailDownloadJob(job),
        actionContext,
        options: [
          { value: "cancel" as const, label: "Cancel job" },
          { value: "back" as const, label: "Back" },
        ],
      });
      if (action === "cancel") {
        await container.downloadService.abort(job.id);
      }
      continue;
    }

    if (job.status === "failed" || job.status === "aborted") {
      const action = await chooseOption({
        title: describeDownloadJob(job),
        subtitle: detailDownloadJob(job),
        actionContext,
        options: [
          { value: "retry" as const, label: "Retry job" },
          { value: "back" as const, label: "Back" },
        ],
      });
      if (action === "retry") {
        container.downloadService.retry(job.id);
        void container.downloadService.processQueue();
      }
      continue;
    }

    if (job.status === "completed") {
      const artifactStatus = await resolveOfflineArtifactStatus(job);
      const action = await chooseOption<CompletedDownloadAction>({
        title: describeDownloadJob(job),
        subtitle: `${formatOfflineSecondaryLine(job, artifactStatus)}  ·  ${job.outputPath}`,
        actionContext,
        options: [
          {
            value: "play",
            label: artifactStatus === "ready" ? "Play downloaded file" : "Play unavailable",
            detail: artifactStatus === "ready" ? "Open local artifact in mpv" : artifactStatus,
          },
          { value: "reveal", label: "Reveal folder", detail: dirname(job.outputPath) },
          {
            value: "retry",
            label: "Re-download",
            detail: "Queue a fresh attempt from stored download intent",
          },
          {
            value: "delete-artifact",
            label: "Delete artifact and job",
            detail: "Remove local media, subtitle artifact, and queue record",
          },
          {
            value: "delete-job",
            label: "Delete job only",
            detail: "Keep files on disk but remove this queue record",
          },
          { value: "back", label: "Back" },
        ],
      });
      if (!action || action === "back") continue;
      if (action === "play") {
        if (artifactStatus !== "ready") {
          container.stateManager.dispatch({
            type: "SET_PLAYBACK_FEEDBACK",
            note: `Offline file unavailable: ${artifactStatus}`,
          });
          container.diagnosticsStore.record({
            category: "download",
            message: "Completed download playback blocked",
            context: { jobId: job.id, artifactStatus, outputPath: job.outputPath },
          });
          continue;
        }
        await container.player.playLocal({
          filePath: job.outputPath,
          displayTitle: formatOfflineJobListingTitle(job),
          subtitlePath: job.subtitlePath ?? null,
          timing: parseIntroSkipTiming(job.introSkipJson),
          attach: false,
        });
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
}

type OfflineBrowsePick = { readonly type: "job"; readonly id: string } | { readonly type: "back" };

type OfflineJobMenuChoice = "play" | "open-folder" | "jobs" | "recheck" | "back";

export async function openOfflineLibraryShell(
  container: Container,
  actionContext?: ListShellActionContext,
  playbackOptions?: { attachPlaybackStdioToMpv?: boolean },
): Promise<void> {
  const attachStdio = playbackOptions?.attachPlaybackStdioToMpv ?? false;
  while (true) {
    const completed = container.downloadService.listCompleted(120);
    if (completed.length === 0) {
      await chooseOption({
        title: "Offline Library",
        subtitle:
          "No completed downloads yet  ·  enqueue during playback (/ → Download current episode)",
        actionContext,
        options: [{ value: "back-empty" as const, label: "Back" }],
      });
      return;
    }

    const rows = await hydrateCompletedOfflineJobs(completed);
    const picked = await chooseOption<OfflineBrowsePick>({
      title: "Offline Library",
      subtitle: `${rows.length} completed  ·  browse and play downloaded files`,
      actionContext,
      options: [
        ...rows.map(({ job, status }) => ({
          value: { type: "job" as const, id: job.id },
          label: `${offlineStatusIcon(status)} ${formatOfflineJobListingTitle(job)}`,
          detail: formatOfflineSecondaryLine(job, status),
        })),
        { value: { type: "back" as const }, label: "Back" },
      ],
    });

    if (!picked || picked.type === "back") {
      return;
    }

    let jobSnapshot =
      rows.find((r) => r.job.id === picked.id)?.job ??
      completed.find((entry) => entry.id === picked.id);
    if (!jobSnapshot) {
      continue;
    }

    while (true) {
      const artifactStatus = await resolveOfflineArtifactStatus(jobSnapshot);
      const action = await chooseOption<OfflineJobMenuChoice>({
        title: formatOfflineJobListingTitle(jobSnapshot),
        subtitle: `${formatOfflineSecondaryLine(jobSnapshot, artifactStatus)}  ·  ${jobSnapshot.outputPath}`,
        actionContext,
        options: [
          {
            value: "play",
            label: "Play now",
            detail:
              artifactStatus === "ready" ? "Open in mpv" : "Unavailable until artifact is readable",
          },
          {
            value: "open-folder",
            label: "Open download folder",
            detail: "Reveal folder in Finder, Explorer, or xdg-open",
          },
          {
            value: "jobs",
            label: "Download jobs",
            detail: "Open /downloads lifecycle panel",
          },
          {
            value: "recheck",
            label: "Refresh artifact status",
            detail: artifactStatus !== "ready" ? "Recommended" : undefined,
          },
          { value: "back", label: "Back" },
        ],
      });

      if (!action || action === "back") {
        break;
      }

      if (action === "recheck") {
        container.diagnosticsStore.record({
          category: "download",
          message: "Offline artifact rechecked",
          context: { jobId: jobSnapshot.id, outcome: artifactStatus, path: jobSnapshot.outputPath },
        });
        const refreshed = container.downloadService.getJob(jobSnapshot.id);
        if (refreshed) jobSnapshot = refreshed;
        continue;
      }

      if (action === "jobs") {
        await openDownloadsShell(container, actionContext);
        continue;
      }

      if (action === "open-folder") {
        const reveal = await revealPathInOsFileManager(jobSnapshot.outputPath);
        if (!reveal.ok) {
          await openStaticInfoShell({
            title: "Could not open folder automatically",
            subtitle: basename(dirname(jobSnapshot.outputPath)),
            lines: [
              { label: "Folder path", detail: dirname(jobSnapshot.outputPath) },
              {
                label: "Error",
                detail: reveal.stderr ?? "System helper exited with an error.",
              },
            ],
          });
        }
        continue;
      }

      if (action !== "play") {
        continue;
      }

      if (artifactStatus !== "ready") {
        await openStaticInfoShell({
          title: "Playback blocked",
          subtitle: formatOfflineJobListingTitle(jobSnapshot),
          lines: [
            { label: "Artifact status", detail: artifactStatus },
            {
              label: "Suggested next steps",
              detail:
                artifactStatus === "missing"
                  ? "Re-queue from playback or inspect failed jobs via Download jobs."
                  : "Replace the corrupt file — delete locally and enqueue a fresh download.",
            },
            { label: "Path", detail: jobSnapshot.outputPath },
          ],
        });
        continue;
      }

      await container.player.playLocal({
        filePath: jobSnapshot.outputPath,
        displayTitle: formatOfflineJobListingTitle(jobSnapshot),
        subtitlePath: jobSnapshot.subtitlePath ?? null,
        timing: parseIntroSkipTiming(jobSnapshot.introSkipJson),
        attach: attachStdio,
      });

      container.diagnosticsStore.record({
        category: "playback",
        message: "Offline playback started",
        context: {
          jobId: jobSnapshot.id,
          outputPath: jobSnapshot.outputPath,
        },
      });
    }
  }
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
  await chooseOption({
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
  stateManager.dispatch({ type: "SET_SUB_LANG", subLang: next.subLang });
  stateManager.dispatch({ type: "SET_ANIME_LANG", animeLang: next.animeLang });

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

export async function handleShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<"handled" | "quit" | "unhandled"> {
  const { providerRegistry, stateManager, config, diagnosticsStore, historyStore, cacheStore } =
    container;

  const withOverlay = async <T>(
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

  if (action === "quit") {
    return await resolveQuitWithDownloadQueue(container);
  }

  if (action === "history") {
    await withOverlay({ type: "history" }, () =>
      openHistoryShell(
        historyStore,
        buildPickerActionContext({ container, taskLabel: "Manage history" }),
      ),
    );
    return "handled";
  }

  if (action === "downloads") {
    await withOverlay({ type: "history" }, () =>
      openDownloadsShell(
        container,
        buildPickerActionContext({ container, taskLabel: "Inspect download jobs" }),
      ),
    );
    return "handled";
  }

  if (action === "library") {
    await withOverlay({ type: "history" }, () =>
      openOfflineLibraryShell(
        container,
        buildPickerActionContext({ container, taskLabel: "Offline library" }),
        { attachPlaybackStdioToMpv: false },
      ),
    );
    return "handled";
  }

  if (action === "help") {
    await withOverlay({ type: "help" }, () =>
      openStaticInfoShell({
        title: "Help",
        subtitle: "Global commands, editing, filtering, and playback navigation",
        lines: [
          {
            label: "/ Command bar",
            detail:
              "Open global actions from anywhere in the shell. Use Tab to autocomplete, ↑↓ to choose, and Enter to run the highlighted command.",
          },
          {
            label: "Esc Clear or close",
            detail:
              "Clear the current transient state first, then close the top overlay or go back one level. Esc should never imply confirm.",
          },
          {
            label: "Enter Search or confirm",
            detail:
              "Searches when the query changed, otherwise confirms the selected result or picker entry.",
          },
          {
            label: "↑↓ Navigate",
            detail: "Move through visible results, episodes, season rows, and command suggestions.",
          },
          {
            label: "Type to filter pickers",
            detail:
              "Season, episode, provider, subtitle, history, and settings pickers all support inline filtering.",
          },
          {
            label: "Ctrl+W Delete previous word",
            detail:
              "Supported in the browse input and picker filters so terminal-native editing keeps working.",
          },
          {
            label: "Tab Switch destination mode",
            detail:
              "In browse, Tab jumps directly into the destination mode shown in the footer, like anime mode or series mode.",
          },
          {
            label: "Ctrl+T Trending",
            detail:
              "Loads the cached discovery list on demand, instead of fetching trending titles during startup.",
          },
          {
            label: "Playback actions",
            detail:
              "Replay, episode picker, provider switch, history, diagnostics, downloads, offline library, and next/previous actions stay reachable after playback ends.",
          },
          {
            label: "Why commands are disabled",
            detail:
              "If an action is unavailable, the footer and command palette show the reason instead of silently ignoring input.",
          },
        ],
      }),
    );
    return "handled";
  }

  if (action === "about") {
    await withOverlay({ type: "about" }, () =>
      openStaticInfoShell({
        title: "About",
        subtitle: "Kunai",
        lines: [
          {
            label: "Version",
            detail: "v0.1.0",
          },
          {
            label: "Runtime",
            detail: `Bun ${Bun.version}  ·  Node ${process.versions.node}`,
          },
          {
            label: "Current mode",
            detail: `${stateManager.getState().mode}  ·  Provider ${stateManager.getState().provider}`,
          },
          {
            label: "Default startup mode",
            detail: `${config.getRaw().defaultMode}  ·  Series ${config.getRaw().provider}  ·  Anime ${config.getRaw().animeProvider}`,
          },
          {
            label: "Capabilities",
            detail:
              container.capabilitySnapshot?.issues.length &&
              container.capabilitySnapshot.issues.length > 0
                ? `${container.capabilitySnapshot.issues.length} degraded startup capability checks`
                : "all required capabilities available",
          },
          {
            label: "Privacy",
            detail: "Diagnostics stay local unless you explicitly export or share them.",
          },
        ],
      }),
    );
    return "handled";
  }

  if (action === "diagnostics") {
    const state = stateManager.getState();
    const recentEvents = diagnosticsStore.getRecent(6);
    await withOverlay({ type: "diagnostics" }, () =>
      openStaticInfoShell({
        title: "Diagnostics",
        subtitle: "Current shell state snapshot",
        lines: [
          {
            label: "Mode and provider",
            detail: `${state.mode}  ·  ${state.provider}`,
          },
          {
            label: "View and playback",
            detail: `${state.view}  ·  ${state.playbackStatus}`,
          },
          {
            label: "Subtitle state",
            detail: describePlaybackSubtitleStatus(state.stream, state.subLang),
          },
          {
            label: "Selected subtitle URL",
            detail: state.stream?.subtitle ?? "not found or disabled",
          },
          {
            label: "Subtitle tracks",
            detail: String(state.stream?.subtitleList?.length ?? 0),
          },
          {
            label: "Stream URL",
            detail: state.stream?.url ?? "not resolved yet",
          },
          {
            label: "Header keys",
            detail: summarizeHeaderKeys(state.stream?.headers),
          },
          {
            label: "Search state",
            detail: `${state.searchState}  ·  ${state.searchResults.length} results`,
          },
          {
            label: "Memory",
            detail: `RSS ${(process.memoryUsage().rss / 1_048_576).toFixed(1)} MB`,
          },
          {
            label: "Startup capabilities",
            detail:
              container.capabilitySnapshot?.issues.length &&
              container.capabilitySnapshot.issues.length > 0
                ? container.capabilitySnapshot.issues
                    .map((issue) => `${issue.id} (${issue.severity})`)
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

  if (action === "provider") {
    const state = stateManager.getState();
    const picked = await withOverlay(
      {
        type: "provider_picker",
        currentProvider: state.provider,
        isAnime: state.mode === "anime",
      },
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
      stateManager.dispatch({
        type: "SET_PROVIDER",
        provider: picked,
      });
    }
    return "handled";
  }

  if (action === "settings" || action === "presence") {
    const next = await withOverlay({ type: "settings" }, () =>
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

  if (action === "setup") {
    await runSetupWizard({ container, force: true });
    return "handled";
  }

  if (action === "clear-cache") {
    const confirm = await chooseOption({
      title: "Clear stream cache?",
      subtitle: "This will remove all cached stream URLs. Next play will require fresh scraping.",
      options: [
        { value: true, label: "Yes, clear cache" },
        { value: false, label: "Cancel" },
      ],
    });
    if (confirm) {
      await cacheStore.clear();
      diagnosticsStore.record({ category: "cache", message: "Stream cache cleared" });
    }
    return "handled";
  }

  if (action === "clear-history") {
    const confirm = await chooseOption({
      title: "Clear watch history?",
      subtitle: "This will remove all saved playback positions and progress.",
      options: [
        { value: true, label: "Yes, clear history" },
        { value: false, label: "Cancel" },
      ],
    });
    if (confirm) {
      await historyStore.clear();
      diagnosticsStore.record({ category: "session", message: "Watch history cleared" });
    }
    return "handled";
  }

  if (action === "export-diagnostics") {
    const snapshot = diagnosticsStore.getSnapshot();
    const redacted = JSON.parse(JSON.stringify(snapshot), (_key, value) => {
      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        return "[redacted-url]";
      }
      return value;
    }) as typeof snapshot;
    const fileName = `kunai-diagnostics-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const path = join(process.cwd(), fileName);
    await writeAtomicJson(path, {
      exportedAt: new Date().toISOString(),
      eventCount: redacted.length,
      events: redacted,
    });
    diagnosticsStore.record({
      category: "ui",
      message: "Diagnostics exported to file",
      context: { path: fileName },
    });
    return "handled";
  }

  if (action === "report-issue") {
    await openIssueUrl();
    diagnosticsStore.record({
      category: "ui",
      message: "Opened issue reporting page",
      context: {
        url: "https://github.com/kitsunekode/kunai/issues/new/choose",
        guidance: "Attach exported diagnostics, provider id, OS, and exact command.",
      },
    });
    return "handled";
  }

  return "unhandled";
}

export async function enqueueCurrentPlaybackDownload({
  container,
  reason,
}: {
  container: Container;
  reason: string;
}): Promise<boolean> {
  const state = container.stateManager.getState();
  if (!state.currentTitle || !state.currentEpisode || !state.stream) {
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
      stream: state.stream,
      providerId: state.provider,
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
  return chooseOption({
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

  return chooseOption({
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

  return chooseOption({
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

  return chooseOption({
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
  return chooseOption({
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

  return chooseOption({
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
    const action = await chooseOption({
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
          value: "subLang" as const,
          label: `Subtitles  ·  ${next.subLang}`,
          detail: "Preferred subtitle behavior",
        },
        {
          value: "animeLang" as const,
          label: `Anime audio  ·  ${next.animeLang}`,
          detail: "Sub or dub preference",
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
      const picked = await chooseOption({
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
      const picked = await chooseOption({
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
      const picked = await chooseOption({
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

    if (action === "subLang") {
      const picked = await chooseOption({
        title: "Subtitle preference",
        subtitle: `Current ${next.subLang}`,
        actionContext,
        options: SUBTITLE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.value === next.subLang ? `${option.label}  ·  current` : option.label,
        })),
      });
      if (picked && picked !== next.subLang) {
        next.subLang = picked;
        changed = true;
      }
      continue;
    }

    if (action === "animeLang") {
      const picked = await chooseOption({
        title: "Anime audio",
        subtitle: `Current ${next.animeLang}`,
        actionContext,
        options: ANIME_AUDIO_OPTIONS.map((option) => ({
          value: option.value,
          label: option.value === next.animeLang ? `${option.label}  ·  current` : option.label,
          detail: option.detail,
        })),
      });
      if (picked && picked !== next.animeLang) {
        next.animeLang = picked;
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
      const picked = await chooseOption({
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
      const picked = await chooseOption({
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
      const picked = await chooseOption({
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
      const picked = await chooseOption({
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
      const picked = await chooseOption({
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
