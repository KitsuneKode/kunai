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
import type { ConfigService } from "@/services/persistence/ConfigService";
import { normalizeSubtitleUrl } from "@/subtitle";
import { getKunaiPaths, type DownloadJobRecord, type DownloadJobsRepository } from "@kunai/storage";

import { persistLanguageHintsFromEnqueueInput } from "./download-language-hints";
import { resolveDownloadFeatureState } from "./DownloadFeature";
import {
  formatPlaybackDownloadStripe,
  pickActiveDownloadForPlayback,
  type PlaybackDownloadMatchInput,
} from "./playback-download-match";
import { buildDownloadStreamPolicy } from "./stream-policy";
import { resolveSubtitleArtifactPath } from "./subtitle-artifact-path";

const DOWNLOAD_FILE_EXT = ".mp4";
const HEARTBEAT_INTERVAL_MS = 15_000;
const STALLED_HEARTBEAT_MS = 90_000;
const STDERR_MAX_BYTES = 64_000;
const DEFAULT_ABORT_GRACE_MS = 2_500;
const DEFAULT_INACTIVE_WAIT_MS = 5_000;
const THUMBNAIL_TIMEOUT_MS = 12_000;

export type DownloadEnqueueEligibility =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: "downloads-disabled" | "yt-dlp-missing" | "insufficient-disk";
      readonly reason: string;
    };

export class DownloadEnqueueRejectedError extends Error {
  constructor(
    readonly code: "downloads-disabled" | "yt-dlp-missing" | "insufficient-disk",
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
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
  readonly selectedQualityLabel?: string;
};

export type DownloadResolveResult = {
  readonly stream: StreamInfo;
  readonly providerId: string;
  readonly selectionChanged?: boolean;
};

type ActiveDownloadProcess = {
  readonly process: Bun.Subprocess;
  cancelRequested: boolean;
  cancelMode: "abort" | "pause";
  cancelReason?: string;
};

export class DownloadService {
  private queueWorkerRunning = false;
  private reconciledStartupJobs = false;
  private readonly cancellationRequests = new Map<
    string,
    { readonly mode: "abort" | "pause"; readonly reason: string }
  >();
  private readonly activeProcesses = new Map<string, ActiveDownloadProcess>();

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
      readonly ffmpegAvailable?: boolean;
      readonly abortGraceMs?: number;
    },
  ) {}

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
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const outputPath = this.resolveOutputPath(input);
    const tempPath = `${outputPath}.tmp.${id}`;
    await mkdir(dirname(outputPath), { recursive: true });

    const diskStats = await statfs(dirname(outputPath));
    const availableGB = (diskStats.bavail * diskStats.bsize) / (1024 * 1024 * 1024);
    if (availableGB < 2) {
      throw new DownloadEnqueueRejectedError(
        "insufficient-disk",
        `Only ${availableGB.toFixed(1)}GB free on download volume. At least 2GB required.`,
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
      selectedQualityLabel: input.selectedQualityLabel,
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
    const parts: string[] = [];
    if (running > 0) parts.push(`${running} running`);
    if (queued > 0) parts.push(`${queued} queued`);
    if (failed.length > 0) parts.push(`${failed.length} failed`);
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
    const matches = (job: DownloadJobRecord) =>
      job.titleId === input.titleId &&
      (input.season === undefined || job.season === input.season) &&
      (input.episode === undefined || job.episode === input.episode) &&
      (job.status === "queued" || job.status === "running" || job.status === "completed");
    return this.listActive(500).some(matches) || this.listCompleted(500).some(matches);
  }

  retry(jobId: string): void {
    this.deps.repo.requeue(jobId, new Date().toISOString());
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
    this.deps.repo.markRunning(next.id, now);

    try {
      const downloaded = await this.executeYtDlpDownload(next);
      await this.downloadSubtitleIfAvailable(downloaded);
      await this.persistOutputFileSize(downloaded);
      const completedAt = new Date().toISOString();
      this.deps.repo.complete(next.id, completedAt);
      const completed = this.deps.repo.get(next.id) ?? null;
      if (completed) {
        void this.generateThumbnailIfAvailable(completed);
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
        }
      } else {
        const analysis = analyzeDownloadFailure(message);
        const retriesLeft = next.retryCount + 1 < next.maxAttempts;
        if (analysis.retryable && retriesLeft) {
          const retryAt = new Date(Date.now() + retryDelayMs(next.retryCount)).toISOString();
          this.deps.repo.scheduleRetry(next.id, message, retryAt, failedAt);
        } else {
          this.deps.repo.fail(next.id, message, true, failedAt, analysis.failureKind);
        }
      }
      await rm(next.tempPath, { force: true }).catch(() => {});
      this.deps.logger.warn("Download failed", { jobId: next.id, error: message });
      return this.deps.repo.get(next.id) ?? null;
    } finally {
      this.activeProcesses.delete(next.id);
      this.cancellationRequests.delete(next.id);
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
      while (true) {
        const processed = await this.processNextQueued();
        if (!processed) {
          break;
        }
      }
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
        subtitleLanguage,
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

    const args = ["--concurrent-fragments", "16", "--newline", "--continue"];

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
      await this.validateCompletedArtifact(job.outputPath);
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

  private async validateCompletedArtifact(outputPath: string): Promise<void> {
    const fileStat = await stat(outputPath);
    if (!fileStat.isFile() || fileStat.size <= 0) {
      throw new Error("artifact-invalid: downloaded file is empty or not a regular file");
    }
    if (!this.deps.ffprobeAvailable || !Bun.which("ffprobe")) {
      return;
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

  private async downloadSubtitleIfAvailable(job: DownloadJobRecord): Promise<void> {
    if (!job.subtitleUrl) return;
    try {
      const policy = buildDownloadStreamPolicy(job.headers);
      const res = await fetch(job.subtitleUrl, {
        headers: policy.headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return;
      }
      const targetPath = resolveSubtitleArtifactPath({
        videoOutputPath: job.outputPath,
        subtitleUrl: job.subtitleUrl,
        contentType: res.headers.get("content-type"),
      });
      const data = await res.arrayBuffer();
      if (data.byteLength <= 0) return;
      await writeAtomicBytes(targetPath, data);
      this.deps.repo.updateOfflineMetadata(
        job.id,
        { subtitlePath: targetPath },
        new Date().toISOString(),
      );
    } catch {
      // subtitle download is best-effort; writeAtomicBytes handles its own temp cleanup
    }
  }

  private async generateThumbnailIfAvailable(job: DownloadJobRecord): Promise<void> {
    if (!this.deps.ffmpegAvailable) return;
    const targetPath = resolveThumbnailArtifactPath(job.outputPath);
    const tempPath = `${targetPath}.tmp.${job.id}`;
    try {
      const existing = await stat(targetPath).catch(() => null);
      if (existing?.isFile() && existing.size > 0) {
        this.deps.repo.updateOfflineMetadata(
          job.id,
          { thumbnailPath: targetPath },
          new Date().toISOString(),
        );
        return;
      }
      await rm(tempPath, { force: true }).catch(() => {});

      const proc = Bun.spawn(
        [
          "ffmpeg",
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          "00:00:12",
          "-i",
          job.outputPath,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-1",
          tempPath,
        ],
        { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
      );
      const exited = await waitForExit(proc.exited, THUMBNAIL_TIMEOUT_MS);
      if (!exited) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best-effort thumbnail generation must never poison the download.
        }
        await waitForExit(proc.exited, 1_000).catch(() => false);
        await rm(tempPath, { force: true }).catch(() => {});
        return;
      }
      const exitCode = await proc.exited.catch(() => 1);
      if (exitCode !== 0) {
        await rm(tempPath, { force: true }).catch(() => {});
        return;
      }
      const thumbnailStat = await stat(tempPath).catch(() => null);
      if (!thumbnailStat?.isFile() || thumbnailStat.size <= 0) {
        await rm(tempPath, { force: true }).catch(() => {});
        return;
      }
      await rename(tempPath, targetPath);
      this.deps.repo.updateOfflineMetadata(
        job.id,
        { thumbnailPath: targetPath },
        new Date().toISOString(),
      );
    } catch (error) {
      this.deps.logger.debug("Offline thumbnail generation skipped", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await rm(tempPath, { force: true }).catch(() => {});
    }
  }

  private selectEligibleQueuedJob(nowIso: string): DownloadJobRecord | null {
    const now = Date.parse(nowIso);
    const queued = this.deps.repo.listQueued(50);
    for (const job of queued) {
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
      configuredBase.length > 0
        ? configuredBase
        : join(dirname(getKunaiPaths().dataDbPath), "downloads");
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

function resolveSubtitleLanguage(stream: StreamInfo): string | null {
  const subtitleKey = stream.subtitle ? normalizeSubtitleUrl(stream.subtitle) : null;
  const candidate = stream.subtitleList?.find(
    (track) => subtitleKey && normalizeSubtitleUrl(track.url) === subtitleKey,
  );
  if (candidate?.language) return candidate.language;
  if (stream.hardSubLanguage) return stream.hardSubLanguage;
  return null;
}
