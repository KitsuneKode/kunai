import { readdirSync, rmSync } from "node:fs";
import { mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import type {
  EpisodeInfo,
  PlaybackTimingMetadata,
  ShellMode,
  StreamInfo,
  TitleInfo,
} from "@/domain/types";
import { writeAtomicBytes } from "@/infra/fs/atomic-write";
import type { Logger } from "@/infra/logger/Logger";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import { cacheOfflinePosterArtwork } from "@/services/offline/offline-artwork-cache";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { normalizeSubtitleUrl } from "@/subtitle";
import {
  getKunaiPaths,
  type DownloadArtifactStatus,
  type DownloadJobRecord,
  type DownloadJobsRepository,
} from "@kunai/storage";

import { persistLanguageHintsFromEnqueueInput } from "./download-language-hints";
import { resolveDownloadFeatureState } from "./DownloadFeature";
import {
  formatPlaybackDownloadStripe,
  pickActiveDownloadForPlayback,
  type PlaybackDownloadMatchInput,
} from "./playback-download-match";
import {
  DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES,
  DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES,
  evaluateStorageAdmission,
  estimateAllowedNewAssets,
} from "./StorageBudgetPolicy";
import { buildDownloadStreamPolicy } from "./stream-policy";
import { resolveSubtitleArtifactPath } from "./subtitle-artifact-path";

const DOWNLOAD_FILE_EXT = ".mp4";
const HEARTBEAT_INTERVAL_MS = 15_000;
const STALLED_HEARTBEAT_MS = 90_000;
const STDERR_MAX_BYTES = 64_000;
const DEFAULT_ABORT_GRACE_MS = 2_500;
const DEFAULT_INACTIVE_WAIT_MS = 5_000;

export type DownloadEnqueueEligibility =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code:
        | "downloads-disabled"
        | "yt-dlp-missing"
        | "insufficient-disk"
        | "duplicate-intent";
      readonly reason: string;
    };

export class DownloadEnqueueRejectedError extends Error {
  constructor(
    readonly code:
      | "downloads-disabled"
      | "yt-dlp-missing"
      | "insufficient-disk"
      | "duplicate-intent",
    readonly reason: string,
  ) {
    super(reason);
  }
}

export type EnqueueDownloadInput = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly stream?: StreamInfo;
  readonly providerId: string;
  readonly mode?: ShellMode;
  readonly audioPreference?: string;
  readonly subtitlePreference?: string;
  readonly qualityPreference?: string;
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
  readonly selectedQualityLabel?: string;
  readonly outputDirectory?: string;
  readonly timing?: PlaybackTimingMetadata | null;
  readonly posterUrl?: string;
};

export type DownloadResolveIntent = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly providerId: string;
  readonly mode: ShellMode;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
  readonly selectedQualityLabel?: string;
};

export type DownloadRepairSummary = {
  readonly checked: number;
  readonly repaired: number;
  readonly stillRepairable: number;
  readonly failed: number;
};

export type DownloadResolveResult = {
  readonly stream: StreamInfo;
  readonly providerId: string;
  readonly selectionChanged?: boolean;
};

export type DownloadEvent =
  | { type: "enqueued"; job: DownloadJobRecord }
  | { type: "progress"; jobId: string; percent: number }
  | { type: "complete"; jobId: string }
  | { type: "failed"; jobId: string; error: string }
  | { type: "aborted"; jobId: string }
  | { type: "deleted"; jobId: string };

type DownloadEventListener = (event: DownloadEvent) => void;

type ActiveDownloadProcess = {
  readonly process: Bun.Subprocess;
  cancelRequested: boolean;
  cancelMode: "abort" | "pause";
  cancelReason?: string;
};

type ArtifactValidationResult = {
  readonly fileSize: number;
  readonly durationMs?: number;
};

type DownloadSidecarResult = {
  readonly artifact: "subtitle" | "artwork";
  readonly status: Extract<
    DownloadArtifactStatus,
    "ready" | "not-applicable" | "optional-missing" | "expected-missing" | "failed"
  >;
  readonly message?: string;
  readonly repairMetadataJson?: string;
};

export class DownloadService {
  private queueWorkerRunning = false;
  private reconciledStartupJobs = false;
  private readonly cancellationRequests = new Map<
    string,
    { readonly mode: "abort" | "pause"; readonly reason: string }
  >();
  private readonly activeProcesses = new Map<string, ActiveDownloadProcess>();
  // Jobs picked by a worker but not yet markRunning in the DB. Lets multiple
  // concurrent workers run without two of them claiming the same queued job in
  // the window between `selectEligibleQueuedJob` and `markRunning` (an await).
  private readonly claimedJobIds = new Set<string>();
  private readonly eventListeners = new Set<DownloadEventListener>();

  onEvent(handler: DownloadEventListener): () => void {
    this.eventListeners.add(handler);
    return () => {
      this.eventListeners.delete(handler);
    };
  }

  private emit(event: DownloadEvent): void {
    for (const handler of this.eventListeners) {
      try {
        handler(event);
      } catch {
        // listener error is non-fatal
      }
    }
  }

  constructor(
    private readonly deps: {
      readonly repo: DownloadJobsRepository;
      readonly config: ConfigService;
      readonly logger: Logger;
      readonly ytDlpAvailable: boolean;
      readonly resolveDownloadStream?: (
        intent: DownloadResolveIntent,
      ) => Promise<DownloadResolveResult | null>;
      readonly ffprobeAvailable?: boolean;
      readonly abortGraceMs?: number;
      readonly diagnostics?: Pick<DiagnosticsService, "record">;
      readonly onCompletedArtifact?: (job: DownloadJobRecord) => Promise<void> | void;
    },
  ) {}

  markArtifactValidated(jobId: string, status: string): void {
    this.deps.repo.markArtifactValidated(
      jobId,
      status as DownloadArtifactStatus,
      new Date().toISOString(),
    );
  }

  getEnqueueEligibility(): DownloadEnqueueEligibility {
    const feature = resolveDownloadFeatureState({
      config: this.deps.config,
      capabilities: { ytDlp: this.deps.ytDlpAvailable },
    });
    if (feature.status === "off") {
      return {
        allowed: false,
        code: "downloads-disabled",
        reason: "Downloads are disabled. Run /setup to enable offline downloads.",
      };
    }
    if (feature.status === "missing-yt-dlp") {
      return {
        allowed: false,
        code: "yt-dlp-missing",
        reason: "yt-dlp is missing. Install yt-dlp to enable downloads.",
      };
    }
    return { allowed: true };
  }

  async enqueue(input: EnqueueDownloadInput): Promise<DownloadJobRecord> {
    const eligibility = this.getEnqueueEligibility();
    if (!eligibility.allowed) {
      throw new DownloadEnqueueRejectedError(eligibility.code, eligibility.reason);
    }
    const existing = this.deps.repo.findBlockingEpisodeIntent({
      titleId: input.title.id,
      season: input.episode?.season,
      episode: input.episode?.episode,
    });
    if (existing) {
      throw new DownloadEnqueueRejectedError(
        "duplicate-intent",
        "A playable or active offline copy already exists for this episode.",
      );
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const outputPath = this.resolveOutputPath(input);
    const tempPath = `${outputPath}.tmp.${id}`;
    await mkdir(dirname(outputPath), { recursive: true });

    const storage = await this.evaluateStorageForPath(outputPath);
    if (!storage.allowed) {
      throw new DownloadEnqueueRejectedError(
        "insufficient-disk",
        this.formatInsufficientDiskMessage(storage.requiredBytes),
      );
    }

    const { subLang, animeLang } = persistLanguageHintsFromEnqueueInput(input);

    this.deps.repo.enqueue({
      id,
      titleId: input.title.id,
      titleName: input.title.name,
      mediaKind: input.title.type,
      season: input.episode?.season,
      episode: input.episode?.episode,
      providerId: input.providerId,
      mode: input.mode,
      subLang,
      animeLang,
      selectedSourceId: input.selectedSourceId,
      selectedStreamId: input.selectedStreamId,
      selectedQualityLabel: input.selectedQualityLabel ?? input.qualityPreference,
      streamUrl: input.stream?.url ?? "",
      headers: input.stream?.headers ?? {},
      outputPath,
      tempPath,
      posterUrl: input.posterUrl ?? input.title.posterUrl,
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
    });

    const subtitleLanguage = input.stream ? resolveSubtitleLanguage(input.stream) : null;
    if (input.stream?.subtitle || input.timing || subtitleLanguage) {
      this.deps.repo.updateOfflineMetadata(
        id,
        {
          subtitleUrl: input.stream?.subtitle ?? null,
          subtitleLanguage,
          introSkipJson: input.timing ? JSON.stringify(input.timing) : null,
        },
        now,
      );
    }

    const created = this.deps.repo.get(id);
    if (!created) {
      throw new Error("Download enqueue failed");
    }
    this.emit({ type: "enqueued", job: created });
    return created;
  }

  listCompleted(limit = 100): readonly DownloadJobRecord[] {
    return this.deps.repo.listCompleted(limit);
  }

  listActive(limit = 100): readonly DownloadJobRecord[] {
    return this.deps.repo.listActive(limit);
  }

  listFailed(limit = 100): readonly DownloadJobRecord[] {
    return this.deps.repo.listFailed(limit);
  }

  getJob(id: string): DownloadJobRecord | undefined {
    return this.deps.repo.get(id);
  }

  /** Non-blocking playback surface: one-line summary for the active download matching the current title/episode. */
  describeActiveDownloadForPlayback(input: PlaybackDownloadMatchInput): string | null {
    const job = pickActiveDownloadForPlayback(this.listActive(120), input);
    return job ? formatPlaybackDownloadStripe(job) : null;
  }

  describeQueueSummary(): string | null {
    const active = this.listActive(120);
    const failed = this.listFailed(20);
    const running = active.filter((job) => job.status === "running").length;
    const queued = active.filter((job) => job.status === "queued").length;
    const repairable = failed.filter((job) => job.status === "repairable").length;
    const terminalFailed = failed.length - repairable;
    const parts: string[] = [];
    if (running > 0) parts.push(`${running} running`);
    if (queued > 0) parts.push(`${queued} queued`);
    if (repairable > 0) parts.push(`${repairable} repairable`);
    if (terminalFailed > 0) parts.push(`${terminalFailed} failed`);
    return parts.length > 0 ? parts.join(" / ") : null;
  }

  hasActiveJobs(): boolean {
    return this.listActive(1).length > 0;
  }

  hasJobForEpisode(input: {
    readonly titleId: string;
    readonly season?: number;
    readonly episode?: number;
  }): boolean {
    return this.deps.repo.findBlockingEpisodeIntent(input) !== undefined;
  }

  async estimateAvailableEpisodeSlots(outputDirectory?: string): Promise<number> {
    const baseDir = outputDirectory?.trim() || this.resolveDefaultDownloadDirectory();
    await mkdir(baseDir, { recursive: true });
    const diskStats = await statfs(baseDir);
    return estimateAllowedNewAssets({
      availableBytes: diskStats.bavail * diskStats.bsize,
      reserveBytes: this.offlineFreeSpaceReserveBytes(),
      unknownEpisodeEstimateBytes: this.offlineUnknownEpisodeEstimateBytes(),
      alreadyReservedBytes: this.estimateActiveReservationBytes(),
      maxAssets: 50,
    });
  }

  async retry(jobId: string): Promise<void> {
    const job = this.deps.repo.get(jobId);
    if (job?.status === "repairable" || job?.status === "completed-with-notes") {
      await this.repairSidecars(job);
      return;
    }
    this.deps.repo.requeue(jobId, new Date().toISOString());
  }

  async repairRepairableSidecars(limit = 100): Promise<DownloadRepairSummary> {
    const jobs = this.listFailed(limit).filter((job) => job.status === "repairable");
    let repaired = 0;
    let stillRepairable = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        await this.repairSidecars(job);
        const refreshed = this.deps.repo.get(job.id);
        if (refreshed?.status === "completed" || refreshed?.status === "completed-with-notes") {
          repaired += 1;
        } else if (refreshed?.status === "repairable") {
          stillRepairable += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger.warn("Download sidecar repair failed", {
          jobId: job.id,
          error: message,
        });
        this.deps.diagnostics?.record({
          category: "download",
          level: "warn",
          operation: "download.artifact.repairable",
          message: "Download sidecar repair failed",
          context: {
            jobId: job.id,
            error: message,
          },
        });
      }
    }

    this.deps.diagnostics?.record({
      category: "download",
      level: failed > 0 ? "warn" : "info",
      operation: "download.artifact.repairable",
      message: "Download sidecar repair sweep completed",
      context: {
        checked: jobs.length,
        repaired,
        stillRepairable,
        failed,
      },
    });

    return { checked: jobs.length, repaired, stillRepairable, failed };
  }

  async processNextQueued(): Promise<DownloadJobRecord | null> {
    const eligibility = this.getEnqueueEligibility();
    if (!eligibility.allowed) {
      return null;
    }

    const now = new Date().toISOString();
    const next = this.selectEligibleQueuedJob(now);
    if (!next) {
      return null;
    }
    // Claim synchronously (no await before this) so a concurrent worker's
    // selectEligibleQueuedJob skips this job until it is markRunning or released.
    this.claimedJobIds.add(next.id);
    const storage = await this.evaluateStorageForPath(next.outputPath, next.id);
    if (!storage.allowed) {
      this.claimedJobIds.delete(next.id);
      const retryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      this.deps.repo.pause(
        next.id,
        this.formatInsufficientDiskMessage(storage.requiredBytes),
        retryAt,
        now,
      );
      this.deps.diagnostics?.record({
        category: "download",
        level: "warn",
        operation: "download.capacity.start",
        message: "Download start delayed because storage reserve would be breached",
        context: {
          jobId: next.id,
          requiredBytes: storage.requiredBytes,
        },
      });
      return null;
    }
    this.deps.repo.markRunning(next.id, now);

    try {
      const downloaded = await this.executeYtDlpDownload(next);
      const subtitleResult = await this.downloadSubtitleIfAvailable(downloaded);
      await this.persistOutputFileSize(downloaded);
      const completedAt = new Date().toISOString();
      this.persistCompletedDownloadWithSidecarResult(next.id, subtitleResult, completedAt);
      this.emit({ type: "complete", jobId: next.id });
      const completed = this.deps.repo.get(next.id) ?? null;
      if (completed) {
        await this.deps.onCompletedArtifact?.(completed);
        if (!this.deps.config.powerSaverMode) {
          runBackgroundTask({
            task: "download.prepareOfflineArtwork",
            category: "download",
            logger: this.deps.logger,
            context: { titleId: completed.titleId, jobId: completed.id },
            run: () => this.prepareOfflineArtwork(completed),
          });
        }
      }
      return completed;
    } catch (error) {
      const active = this.activeProcesses.get(next.id);
      const cancellation = this.cancellationRequests.get(next.id);
      const cancelled = active?.cancelRequested === true || cancellation !== undefined;
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      if (cancelled) {
        if (active?.cancelMode === "pause" || cancellation?.mode === "pause") {
          this.deps.repo.pause(
            next.id,
            active?.cancelReason ?? cancellation?.reason ?? "download paused by shutdown",
            failedAt,
            failedAt,
          );
        } else {
          this.deps.repo.abort(next.id, failedAt);
          this.emit({ type: "aborted", jobId: next.id });
        }
      } else {
        const analysis = analyzeDownloadFailure(message);
        const retriesLeft = next.retryCount + 1 < next.maxAttempts;
        if (analysis.retryable && retriesLeft) {
          const retryAt = new Date(Date.now() + retryDelayMs(next.retryCount)).toISOString();
          this.deps.repo.scheduleRetry(next.id, message, retryAt, failedAt);
        } else {
          this.deps.repo.fail(next.id, message, true, failedAt, analysis.failureKind);
          this.emit({ type: "failed", jobId: next.id, error: message });
        }
      }
      await rm(next.tempPath, { force: true }).catch(() => {});
      this.deps.logger.warn("Download failed", { jobId: next.id, error: message });
      return this.deps.repo.get(next.id) ?? null;
    } finally {
      this.activeProcesses.delete(next.id);
      this.cancellationRequests.delete(next.id);
      this.claimedJobIds.delete(next.id);
    }
  }

  async processQueue(): Promise<void> {
    if (this.queueWorkerRunning) {
      return;
    }
    this.queueWorkerRunning = true;
    try {
      if (!this.reconciledStartupJobs) {
        this.reconcileInterruptedJobs();
        this.reconciledStartupJobs = true;
      }
      this.reconcileStalledJobs();
      // Run up to `maxConcurrentDownloads` workers in parallel; each drains the
      // queue (claim → download) until no eligible job remains. The atomic claim
      // in processNextQueued keeps two workers off the same job.
      const limit = Math.max(1, Math.min(5, Math.trunc(this.deps.config.maxConcurrentDownloads) || 1));
      const worker = async (): Promise<void> => {
        while (await this.processNextQueued()) {
          // keep pulling jobs
        }
      };
      await Promise.all(Array.from({ length: limit }, () => worker()));
    } finally {
      this.queueWorkerRunning = false;
    }
  }

  async drainQueue(maxWaitMs = 60_000): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    while (this.hasActiveJobs() && Date.now() < deadline) {
      await this.processQueue();
      if (this.hasActiveJobs()) {
        await Bun.sleep(250);
      }
    }
  }

  async abort(jobId: string): Promise<void> {
    const job = this.deps.repo.get(jobId);
    if (!job) {
      return;
    }
    const active = this.activeProcesses.get(jobId);
    this.cancellationRequests.set(jobId, {
      mode: "abort",
      reason: "download aborted by user",
    });
    if (active) {
      active.cancelRequested = true;
      active.cancelMode = "abort";
      active.cancelReason = "download aborted by user";
      await this.terminateProcess(active.process);
      return;
    }
    await rm(job.tempPath, { force: true }).catch(() => {});
    this.deps.repo.abort(jobId, new Date().toISOString());
  }

  async pauseActiveJobsForShutdown(reason = "download paused by shutdown"): Promise<void> {
    const runningJobIds = this.deps.repo.listRunning(200).map((job) => job.id);
    for (const jobId of runningJobIds) {
      this.cancellationRequests.set(jobId, { mode: "pause", reason });
    }
    const activeEntries = await this.collectActiveProcesses(runningJobIds, 250);
    if (activeEntries.length === 0) return;
    for (const [, active] of activeEntries) {
      active.cancelRequested = true;
      active.cancelMode = "pause";
      active.cancelReason = reason;
    }
    await Promise.all(activeEntries.map(([, active]) => this.terminateProcess(active.process)));
    await this.waitForInactive(
      activeEntries.map(([jobId]) => jobId),
      DEFAULT_INACTIVE_WAIT_MS,
    );
    const pausedAt = new Date().toISOString();
    for (const [jobId] of activeEntries) {
      const job = this.deps.repo.get(jobId);
      if (job && job.status !== "completed" && job.status !== "aborted") {
        this.deps.repo.pause(jobId, reason, pausedAt, pausedAt);
      }
    }
  }

  async deleteJob(jobId: string, opts: { deleteArtifact?: boolean } = {}): Promise<void> {
    const job = this.deps.repo.get(jobId);
    if (!job) return;
    if (job.status === "running" || this.activeProcesses.has(jobId)) {
      await this.abort(jobId);
    }
    await rm(job.tempPath, { force: true }).catch(() => {});
    if (opts.deleteArtifact) {
      await rm(job.outputPath, { force: true }).catch(() => {});
      if (job.subtitlePath) await rm(job.subtitlePath, { force: true }).catch(() => {});
      if (job.thumbnailPath) await rm(job.thumbnailPath, { force: true }).catch(() => {});
      const derivedThumbnailPath = resolveThumbnailArtifactPath(job.outputPath);
      if (derivedThumbnailPath !== job.thumbnailPath) {
        await rm(derivedThumbnailPath, { force: true }).catch(() => {});
      }
    }
    this.deps.repo.delete(jobId);
    this.emit({ type: "deleted", jobId });
  }

  private async executeYtDlpDownload(job: DownloadJobRecord): Promise<DownloadJobRecord> {
    const resolved = await this.resolveStreamForJob(job);
    const subtitleLanguage = resolveSubtitleLanguage(resolved.stream);
    const updatedAt = new Date().toISOString();
    this.deps.repo.updateResolvedStream(
      job.id,
      {
        streamUrl: resolved.stream.url,
        headers: resolved.stream.headers,
        providerId: resolved.providerId,
      },
      updatedAt,
    );
    this.deps.repo.updateOfflineMetadata(
      job.id,
      {
        subtitleUrl: resolved.stream.subtitle ?? null,
        subtitlePath: null,
        subtitleLanguage: subtitleLanguage ?? (job.subtitleUrl ? null : job.subtitleLanguage),
      },
      updatedAt,
    );
    job = this.deps.repo.get(job.id) ?? {
      ...job,
      streamUrl: resolved.stream.url,
      headers: resolved.stream.headers,
      subtitleUrl: resolved.stream.subtitle ?? job.subtitleUrl,
      subtitleLanguage: subtitleLanguage ?? job.subtitleLanguage,
      lastResolvedProviderId: resolved.providerId as never,
    };

    const args = [
      "--concurrent-fragments",
      "16",
      "--newline",
      "--continue",
      // Reliability: provider HLS (vidlink/stormvv/…) ships flaky fragments. Without
      // retries a single transient 403/timeout aborts the whole download (leaving
      // orphan .part fragments). Retry the request and each fragment before failing.
      "--retries",
      "10",
      "--fragment-retries",
      "10",
      "--retry-sleep",
      "2",
    ];

    // Quality: yt-dlp's default already takes the highest video+audio, so we only
    // constrain when the user picked/configured a specific ceiling (e.g. 720p to
    // save disk). Unset → undefined → keep the default (highest available).
    const formatSelector = ytDlpFormatSelectorForQuality(job.selectedQualityLabel);
    if (formatSelector) {
      args.push("-f", formatSelector);
    }

    // Add headers
    for (const [key, value] of Object.entries(job.headers)) {
      if (value) {
        args.push("--add-header", `${key}: ${value}`);
      }
    }

    args.push("-o", job.tempPath, job.streamUrl);

    const proc = Bun.spawn(["yt-dlp", ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    const cancellation = this.cancellationRequests.get(job.id);
    this.activeProcesses.set(job.id, {
      process: proc,
      cancelRequested: cancellation !== undefined,
      cancelMode: cancellation?.mode ?? "abort",
      cancelReason: cancellation?.reason,
    });

    const stopHeartbeat = this.startHeartbeat(job.id);

    let stderr = "";
    let lastProgressPersistAt = 0;
    let lastPersistedPercent = 0;

    const persistProgress = (percent: number) => {
      const now = Date.now();
      const clamped = Math.round(Math.max(0, Math.min(99, percent)));
      if (clamped === lastPersistedPercent) return;
      if (now - lastProgressPersistAt < 1000) return;
      this.deps.repo.updateProgress(job.id, clamped, new Date().toISOString());
      this.emit({ type: "progress", jobId: job.id, percent: clamped });
      lastProgressPersistAt = now;
      lastPersistedPercent = clamped;
    };

    const readStdout = readLines(proc.stdout, (line) => {
      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match && match[1]) {
        const percent = Number.parseFloat(match[1]);
        if (Number.isFinite(percent)) {
          persistProgress(percent);
        }
      }
      if (line.includes("100%") || line.includes("has already been downloaded")) {
        persistProgress(99);
      }
    });

    const readStderr = readLines(proc.stderr, (line) => {
      stderr = appendBounded(stderr, line, STDERR_MAX_BYTES);
    });

    try {
      const exitCode = await proc.exited;
      await Promise.all([readStdout, readStderr]);

      if (
        exitCode !== 0 &&
        !this.activeProcesses.get(job.id)?.cancelRequested &&
        !this.cancellationRequests.has(job.id)
      ) {
        throw new Error(stderr.trim() || `yt-dlp exited with code ${exitCode}`);
      }

      if (
        this.activeProcesses.get(job.id)?.cancelRequested ||
        this.cancellationRequests.has(job.id)
      ) {
        throw new Error("download aborted");
      }

      await rename(job.tempPath, job.outputPath);
      const validation = await this.validateCompletedArtifact(job.outputPath);
      this.persistValidatedArtifactMetadata(job.id, validation);
      return this.deps.repo.get(job.id) ?? job;
    } finally {
      stopHeartbeat();
    }
  }

  private async resolveStreamForJob(job: DownloadJobRecord): Promise<DownloadResolveResult> {
    const fallbackStream =
      job.streamUrl.trim().length > 0
        ? {
            stream: {
              url: job.streamUrl,
              headers: job.headers,
              timestamp: Date.now(),
              subtitle: job.subtitleUrl,
            },
            providerId: job.providerId,
            selectionChanged: false,
          }
        : null;

    if (!this.deps.resolveDownloadStream) {
      if (fallbackStream) return fallbackStream;
      throw new Error("download stream resolver unavailable");
    }

    const mode = job.mode ?? (job.mediaKind === "anime" ? "anime" : "series");
    const resolved = await this.deps.resolveDownloadStream({
      title: {
        id: job.titleId,
        type: job.mediaKind === "movie" ? "movie" : "series",
        name: job.titleName,
      },
      episode:
        job.season !== undefined && job.episode !== undefined
          ? { season: job.season, episode: job.episode }
          : undefined,
      providerId: job.providerId,
      mode,
      audioPreference: mode === "anime" ? (job.animeLang === "dub" ? "dub" : "sub") : "original",
      subtitlePreference: job.subLang ?? "eng",
      qualityPreference: job.selectedQualityLabel,
      selectedSourceId: job.selectedSourceId,
      selectedStreamId: job.selectedStreamId,
      selectedQualityLabel: job.selectedQualityLabel,
    });

    if (resolved) {
      if (resolved.selectionChanged) {
        this.deps.logger.warn("Download stream selection changed during re-resolve", {
          jobId: job.id,
          providerId: resolved.providerId,
        });
      }
      return resolved;
    }
    if (fallbackStream) return fallbackStream;
    throw new Error("download stream resolve failed");
  }

  private async terminateProcess(proc: Bun.Subprocess): Promise<void> {
    const graceMs = this.deps.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS;
    try {
      proc.kill("SIGTERM");
    } catch {
      return;
    }

    const exitedAfterTerm = await waitForExit(proc.exited, graceMs);
    if (exitedAfterTerm) {
      return;
    }

    try {
      proc.kill("SIGKILL");
    } catch {
      return;
    }
    await waitForExit(proc.exited, graceMs).catch(() => {});
  }

  private async waitForInactive(jobIds: readonly string[], timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (jobIds.every((jobId) => !this.activeProcesses.has(jobId))) {
        return;
      }
      await Bun.sleep(25);
    }
  }

  private async collectActiveProcesses(
    jobIds: readonly string[],
    timeoutMs: number,
  ): Promise<readonly [string, ActiveDownloadProcess][]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const entries = jobIds.flatMap((jobId) => {
        const active = this.activeProcesses.get(jobId);
        return active ? [[jobId, active] as [string, ActiveDownloadProcess]] : [];
      });
      if (entries.length > 0 || !this.queueWorkerRunning) {
        return entries;
      }
      await Bun.sleep(10);
    }
    return jobIds.flatMap((jobId) => {
      const active = this.activeProcesses.get(jobId);
      return active ? [[jobId, active] as [string, ActiveDownloadProcess]] : [];
    });
  }

  private async validateCompletedArtifact(outputPath: string): Promise<ArtifactValidationResult> {
    const fileStat = await stat(outputPath);
    if (!fileStat.isFile() || fileStat.size <= 0) {
      throw new Error("artifact-invalid: downloaded file is empty or not a regular file");
    }
    if (!this.deps.ffprobeAvailable || !Bun.which("ffprobe")) {
      return { fileSize: fileStat.size };
    }
    const proc = Bun.spawn(
      [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        outputPath,
      ],
      { stdin: "ignore", stdout: "pipe", stderr: "ignore" },
    );
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    if (exitCode !== 0) {
      throw new Error("artifact-invalid: ffprobe could not inspect downloaded file");
    }
    const duration = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("artifact-invalid: ffprobe reported no playable duration");
    }
    return { fileSize: fileStat.size, durationMs: Math.round(duration * 1_000) };
  }

  private persistValidatedArtifactMetadata(
    jobId: string,
    validation: ArtifactValidationResult,
  ): void {
    const updatedAt = new Date().toISOString();
    this.deps.repo.updateFileSize(jobId, validation.fileSize, updatedAt);
    if (typeof validation.durationMs === "number") {
      this.deps.repo.updateOfflineMetadata(jobId, { durationMs: validation.durationMs }, updatedAt);
    }
    this.deps.diagnostics?.record({
      category: "download",
      level: "info",
      operation: "download.artifact.validated",
      message: "Download artifact validated",
      context: {
        jobId,
        fileSize: validation.fileSize,
        durationMs: validation.durationMs,
      },
    });
  }

  private async persistOutputFileSize(job: DownloadJobRecord): Promise<number | null> {
    try {
      const fileStat = await stat(job.outputPath);
      if (fileStat.isFile()) {
        this.deps.repo.updateFileSize(job.id, fileStat.size, new Date().toISOString());
        return fileStat.size;
      }
    } catch {
      // ignore output stat failures
    }
    return null;
  }

  private async downloadSubtitleIfAvailable(
    job: DownloadJobRecord,
  ): Promise<DownloadSidecarResult> {
    if (!job.subtitleUrl) {
      return {
        artifact: "subtitle",
        status: "not-applicable",
      };
    }
    try {
      const policy = buildDownloadStreamPolicy(job.headers);
      const res = await fetch(job.subtitleUrl, {
        headers: policy.headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return buildRepairableSidecarResult(
          job,
          "subtitle",
          `subtitle request failed: ${res.status}`,
        );
      }
      const targetPath = resolveSubtitleArtifactPath({
        videoOutputPath: job.outputPath,
        subtitleUrl: job.subtitleUrl,
        contentType: res.headers.get("content-type"),
      });
      const data = await res.arrayBuffer();
      if (data.byteLength <= 0) {
        return buildRepairableSidecarResult(job, "subtitle", "subtitle response was empty");
      }
      await writeAtomicBytes(targetPath, data);
      this.deps.repo.updateOfflineMetadata(
        job.id,
        { subtitlePath: targetPath },
        new Date().toISOString(),
      );
      return {
        artifact: "subtitle",
        status: "ready",
      };
    } catch (error) {
      return buildRepairableSidecarResult(
        job,
        "subtitle",
        error instanceof Error ? error.message : "subtitle download failed",
      );
    }
  }

  private persistCompletedDownloadWithSidecarResult(
    jobId: string,
    result: DownloadSidecarResult,
    updatedAt: string,
  ): void {
    if (result.status === "expected-missing" || result.status === "failed") {
      this.deps.repo.markRepairable(
        jobId,
        {
          artifactStatus: result.status,
          message: result.message ?? `${result.artifact} sidecar needs repair`,
          repairMetadataJson:
            result.repairMetadataJson ??
            JSON.stringify({ artifact: result.artifact, message: result.message }),
        },
        updatedAt,
      );
      this.deps.diagnostics?.record({
        category: "download",
        level: result.status === "failed" ? "warn" : "info",
        operation: "download.artifact.repairable",
        message: "Download completed with repairable sidecar",
        context: {
          jobId,
          artifact: result.artifact,
          artifactStatus: result.status,
          message: result.message ?? null,
        },
      });
      return;
    }
    if (result.status === "optional-missing") {
      this.deps.repo.completeWithNotes(
        jobId,
        {
          artifactStatus: "optional-missing",
          message: result.message ?? `${result.artifact} sidecar was unavailable`,
          repairMetadataJson: result.repairMetadataJson,
        },
        updatedAt,
      );
      return;
    }
    this.deps.repo.complete(jobId, updatedAt);
  }

  private async repairSidecars(job: DownloadJobRecord): Promise<void> {
    const output = await stat(job.outputPath).catch(() => null);
    const repairedAt = new Date().toISOString();
    if (!output?.isFile() || output.size <= 0) {
      this.deps.repo.fail(
        job.id,
        "download artifact missing before sidecar repair",
        true,
        repairedAt,
        "artifact-missing",
      );
      return;
    }

    const subtitleResult = await this.downloadSubtitleIfAvailable(job);
    this.persistCompletedDownloadWithSidecarResult(job.id, subtitleResult, repairedAt);
    const refreshed = this.deps.repo.get(job.id);
    if (refreshed) {
      await this.deps.onCompletedArtifact?.(refreshed);
    }
    if (refreshed?.status === "completed" && !this.deps.config.powerSaverMode) {
      runBackgroundTask({
        task: "download.prepareOfflineArtwork.repair",
        category: "download",
        logger: this.deps.logger,
        context: { titleId: refreshed.titleId, jobId: refreshed.id },
        run: () => this.prepareOfflineArtwork(refreshed),
      });
    }
  }

  private maybeMarkOptionalArtworkMissing(job: DownloadJobRecord, message: string): void {
    const refreshed = this.deps.repo.get(job.id);
    if (!refreshed || refreshed.status !== "completed") return;
    this.deps.repo.completeWithNotes(
      job.id,
      {
        artifactStatus: "optional-missing",
        message,
        repairMetadataJson: JSON.stringify({
          artifact: "artwork",
          outputPath: job.outputPath,
          posterUrl: job.posterUrl,
        }),
      },
      new Date().toISOString(),
    );
  }

  private async prepareOfflineArtwork(job: DownloadJobRecord): Promise<void> {
    const refreshed = this.deps.repo.get(job.id) ?? job;
    if (
      refreshed.thumbnailPath ||
      !refreshed.posterUrl ||
      !this.deps.config.offlineArtworkCacheEnabled
    ) {
      return;
    }
    try {
      const posterPath = await cacheOfflinePosterArtwork({ job: refreshed });
      if (!posterPath) {
        this.maybeMarkOptionalArtworkMissing(job, "Poster artwork could not be cached");
        return;
      }
      this.deps.repo.updateOfflineMetadata(
        job.id,
        { thumbnailPath: posterPath },
        new Date().toISOString(),
      );
    } catch (error) {
      this.maybeMarkOptionalArtworkMissing(job, "Poster artwork could not be cached");
      this.deps.logger.debug("Offline poster artwork cache skipped", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private selectEligibleQueuedJob(nowIso: string): DownloadJobRecord | null {
    const now = Date.parse(nowIso);
    const queued = this.deps.repo.listQueued(50);
    for (const job of queued) {
      if (this.claimedJobIds.has(job.id)) continue;
      if (!job.nextRetryAt) return job;
      const retryAt = Date.parse(job.nextRetryAt);
      if (Number.isFinite(retryAt) && retryAt <= now) return job;
    }
    return null;
  }

  private reconcileInterruptedJobs(): void {
    const now = new Date().toISOString();
    const cleanedDirs = new Set<string>();
    for (const runningJob of this.deps.repo.listRunning(200)) {
      // Clean up orphaned temp files from crashed processes
      if (runningJob.tempPath) {
        const dir = dirname(runningJob.tempPath);
        if (!cleanedDirs.has(dir)) {
          cleanedDirs.add(dir);
          this.cleanupOrphanedTempFiles(dir);
        }
        rm(runningJob.tempPath, { force: true }).catch(() => {});
      }
      if (runningJob.retryCount < runningJob.maxAttempts) {
        this.deps.repo.scheduleRetry(
          runningJob.id,
          "download interrupted by previous session shutdown",
          now,
          now,
        );
      } else {
        this.deps.repo.fail(
          runningJob.id,
          "download interrupted and retry limit reached",
          false,
          now,
          "interrupted",
        );
      }
    }
  }

  /** Scan a directory for orphaned .tmp.* files and remove them. */
  private cleanupOrphanedTempFiles(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.includes(".tmp.")) {
          const fullPath = join(dir, entry.name);
          rmSync(fullPath, { force: true });
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  private reconcileStalledJobs(): void {
    const now = Date.now();
    for (const runningJob of this.deps.repo.listRunning(200)) {
      if (this.activeProcesses.has(runningJob.id)) continue;
      const heartbeatAt = runningJob.lastHeartbeatAt ?? runningJob.startedAt;
      const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : Number.NaN;
      if (!Number.isFinite(heartbeatMs)) continue;
      if (now - heartbeatMs < STALLED_HEARTBEAT_MS) continue;
      const updatedAt = new Date().toISOString();
      if (runningJob.retryCount < runningJob.maxAttempts) {
        this.deps.repo.scheduleRetry(
          runningJob.id,
          "download stalled; rescheduling",
          updatedAt,
          updatedAt,
        );
      } else {
        this.deps.repo.fail(
          runningJob.id,
          "download stalled and retry limit reached",
          false,
          updatedAt,
          "stalled",
        );
      }
    }
  }

  private startHeartbeat(jobId: string): () => void {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (!active) return;
      this.deps.repo.markHeartbeat(jobId, new Date().toISOString());
      timer = setTimeout(tick, HEARTBEAT_INTERVAL_MS);
      timer.unref?.();
    };
    timer = setTimeout(tick, HEARTBEAT_INTERVAL_MS);
    timer.unref?.();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }

  private resolveOutputPath(input: EnqueueDownloadInput): string {
    const configuredBase = input.outputDirectory?.trim() || this.deps.config.downloadPath.trim();
    const baseDir =
      configuredBase.length > 0 ? configuredBase : this.resolveDefaultDownloadDirectory();
    const titleName = sanitizePathPart(input.title.name) || "Untitled";
    const yearSuffix = normalizeYear(input.title.year);

    if (input.title.type === "movie" || !input.episode) {
      const movieFolder = yearSuffix ? `${titleName} (${yearSuffix})` : titleName;
      const movieFile = yearSuffix
        ? `${titleName} (${yearSuffix})${DOWNLOAD_FILE_EXT}`
        : `${titleName}${DOWNLOAD_FILE_EXT}`;
      return join(baseDir, movieFolder, movieFile);
    }

    const season = Math.max(1, Math.trunc(input.episode.season));
    const episode = Math.max(1, Math.trunc(input.episode.episode));
    const seriesFolder = yearSuffix ? `${titleName} (${yearSuffix})` : titleName;
    const seasonFolder = `Season ${String(season).padStart(2, "0")}`;
    const episodeFile = `${titleName} - S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}${DOWNLOAD_FILE_EXT}`;
    return join(baseDir, seriesFolder, seasonFolder, episodeFile);
  }

  private resolveDefaultDownloadDirectory(): string {
    const configuredBase = this.deps.config.downloadPath.trim();
    return configuredBase.length > 0
      ? configuredBase
      : join(dirname(getKunaiPaths().dataDbPath), "downloads");
  }

  private async evaluateStorageForPath(outputPath: string, excludeJobId?: string) {
    await mkdir(dirname(outputPath), { recursive: true });
    const diskStats = await statfs(dirname(outputPath));
    return evaluateStorageAdmission({
      availableBytes: diskStats.bavail * diskStats.bsize,
      reserveBytes: this.offlineFreeSpaceReserveBytes(),
      unknownEpisodeEstimateBytes: this.offlineUnknownEpisodeEstimateBytes(),
      alreadyReservedBytes: this.estimateActiveReservationBytes(excludeJobId),
    });
  }

  private estimateActiveReservationBytes(excludeJobId?: string): number {
    return this.listActive(200)
      .filter((job) => job.id !== excludeJobId)
      .reduce(
        (total, job) => total + (job.fileSize ?? this.offlineUnknownEpisodeEstimateBytes()),
        0,
      );
  }

  private offlineFreeSpaceReserveBytes(): number {
    return (
      this.deps.config.offlineFreeSpaceReserveBytes ?? DEFAULT_OFFLINE_FREE_SPACE_RESERVE_BYTES
    );
  }

  private offlineUnknownEpisodeEstimateBytes(): number {
    return (
      this.deps.config.offlineUnknownEpisodeEstimateBytes ?? DEFAULT_UNKNOWN_EPISODE_ESTIMATE_BYTES
    );
  }

  private formatInsufficientDiskMessage(requiredBytes: number): string {
    const requiredGB = requiredBytes / (1024 * 1024 * 1024);
    return `Download paused because the offline safety reserve needs ${requiredGB.toFixed(1)}GB available on the download volume.`;
  }
}

function sanitizePathPart(value: string): string {
  return value
    .trim()
    .replaceAll(/[<>:"/\\|?*]+/g, " ")
    .split("")
    .filter((char) => char.charCodeAt(0) >= 32)
    .join("")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/[. ]+$/g, "");
}

function normalizeYear(value: string | undefined): string | null {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? null;
}

async function readLines(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => void,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) break;
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        onLine(line);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function retryDelayMs(retryCount: number): number {
  const table = [2_000, 5_000, 15_000, 30_000];
  return table[Math.min(retryCount, table.length - 1)] ?? 30_000;
}

async function waitForExit(exited: Promise<number>, timeoutMs: number): Promise<boolean> {
  const marker = Symbol("timeout");
  const result = await Promise.race([exited, Bun.sleep(timeoutMs).then(() => marker)]);
  return result !== marker;
}

function analyzeDownloadFailure(message: string): { failureKind: string; retryable: boolean } {
  const normalized = message.toLowerCase();
  if (normalized.includes("artifact-invalid")) {
    return { failureKind: "artifact-invalid", retryable: false };
  }
  if (normalized.includes("download aborted") || normalized.includes("aborted")) {
    return { failureKind: "aborted", retryable: false };
  }
  if (
    normalized.includes("invalid argument") ||
    normalized.includes("unrecognized option") ||
    normalized.includes("option not found") ||
    normalized.includes("no such option")
  ) {
    return { failureKind: "ytdlp-config", retryable: false };
  }
  if (normalized.includes("unsupported url") || normalized.includes("protocol not found")) {
    return { failureKind: "protocol", retryable: false };
  }
  if (
    normalized.includes("http error 403") ||
    normalized.includes("http error 401") ||
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized")
  ) {
    return { failureKind: "http-auth", retryable: false };
  }
  if (normalized.includes("http error 4")) {
    return { failureKind: "http-client", retryable: false };
  }
  if (normalized.includes("http error 5")) {
    return { failureKind: "http-server", retryable: true };
  }
  if (
    normalized.includes("timed out") ||
    normalized.includes("connection") ||
    normalized.includes("unable to download webpage") ||
    normalized.includes("network is unreachable")
  ) {
    return { failureKind: "network", retryable: true };
  }
  return { failureKind: "unknown", retryable: true };
}

function appendBounded(current: string, line: string, maxBytes: number): string {
  const next = `${current}${line}\n`;
  if (next.length <= maxBytes) return next;
  return next.slice(next.length - maxBytes);
}

function resolveThumbnailArtifactPath(outputPath: string): string {
  const extension = extname(outputPath);
  if (!extension) return `${outputPath}.thumbnail.jpg`;
  return `${outputPath.slice(0, -extension.length)}.thumbnail.jpg`;
}

/**
 * yt-dlp `-f` selector honoring a configured/selected quality CEILING. Returns
 * undefined when no specific quality is set ("best"/"auto"/unlabelled) so yt-dlp's
 * default (highest video+audio) is kept — "highest when not mentioned, honor the
 * configured quality when it is". The `/best` tail guarantees a fallback when a
 * single-rendition or progressive URL has no separate height-tagged formats.
 */
export function ytDlpFormatSelectorForQuality(qualityLabel?: string): string | undefined {
  const height = Number(qualityLabel?.match(/(\d{3,4})\s*p/i)?.[1] ?? "");
  if (!Number.isFinite(height) || height <= 0) return undefined;
  return `best[height<=${height}]/bestvideo[height<=${height}]+bestaudio/best`;
}

function resolveSubtitleLanguage(stream: StreamInfo): string | null {
  const subtitleKey = stream.subtitle ? normalizeSubtitleUrl(stream.subtitle) : null;
  const candidate = stream.subtitleList?.find(
    (track) => subtitleKey && normalizeSubtitleUrl(track.url) === subtitleKey,
  );
  if (candidate?.language) return candidate.language;
  if (stream.hardSubLanguage) return stream.hardSubLanguage;
  return null;
}

function buildRepairableSidecarResult(
  job: DownloadJobRecord,
  artifact: "subtitle" | "artwork",
  message: string,
): DownloadSidecarResult {
  return {
    artifact,
    status: "expected-missing",
    message,
    repairMetadataJson: JSON.stringify({
      artifact,
      message,
      outputPath: job.outputPath,
      subtitleUrl: job.subtitleUrl,
      subtitleLanguage: job.subtitleLanguage,
      posterUrl: job.posterUrl,
    }),
  };
}
