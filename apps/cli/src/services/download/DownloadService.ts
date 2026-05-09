import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { EpisodeInfo, PlaybackTimingMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { getKunaiPaths, type DownloadJobRecord, type DownloadJobsRepository } from "@kunai/storage";

import { resolveDownloadFeatureState } from "./DownloadFeature";
import {
  formatPlaybackDownloadStripe,
  pickActiveDownloadForPlayback,
  type PlaybackDownloadMatchInput,
} from "./playback-download-match";
import { buildDownloadStreamPolicy } from "./stream-policy";

const DOWNLOAD_FILE_EXT = ".mp4";
const HEARTBEAT_INTERVAL_MS = 15_000;
const STALLED_HEARTBEAT_MS = 90_000;
const STDERR_MAX_BYTES = 64_000;

export type DownloadEnqueueEligibility =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: "downloads-disabled" | "ffmpeg-missing";
      readonly reason: string;
    };

export class DownloadEnqueueRejectedError extends Error {
  constructor(
    readonly code: "downloads-disabled" | "ffmpeg-missing",
    readonly reason: string,
  ) {
    super(reason);
  }
}

export type EnqueueDownloadInput = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly stream: StreamInfo;
  readonly providerId: string;
  readonly timing?: PlaybackTimingMetadata | null;
};

export class DownloadService {
  private queueWorkerRunning = false;
  private reconciledStartupJobs = false;
  private readonly activeProcesses = new Map<
    string,
    { process: Bun.Subprocess; cancelRequested: boolean }
  >();

  constructor(
    private readonly deps: {
      readonly repo: DownloadJobsRepository;
      readonly config: ConfigService;
      readonly logger: Logger;
      readonly ffmpegAvailable: boolean;
    },
  ) {}

  getEnqueueEligibility(): DownloadEnqueueEligibility {
    const feature = resolveDownloadFeatureState({
      config: this.deps.config,
      capabilities: { ffmpeg: this.deps.ffmpegAvailable },
    });
    if (feature.status === "off") {
      return {
        allowed: false,
        code: "downloads-disabled",
        reason: "Downloads are disabled. Run /setup to enable offline downloads.",
      };
    }
    if (feature.status === "missing-ffmpeg") {
      return {
        allowed: false,
        code: "ffmpeg-missing",
        reason: "ffmpeg is missing. Install ffmpeg to enable downloads.",
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
    const id = randomUUID();
    const outputPath = this.resolveOutputPath(input);
    const tempPath = `${outputPath}.tmp.${id}`;
    await mkdir(dirname(outputPath), { recursive: true });

    this.deps.repo.enqueue({
      id,
      titleId: input.title.id,
      titleName: input.title.name,
      mediaKind: input.title.type,
      season: input.episode?.season,
      episode: input.episode?.episode,
      providerId: input.providerId,
      streamUrl: input.stream.url,
      headers: input.stream.headers,
      outputPath,
      tempPath,
      createdAt: now,
      updatedAt: now,
      completedAt: undefined,
    });

    const subtitleLanguage = resolveSubtitleLanguage(input.stream);
    if (input.stream.subtitle || input.timing || subtitleLanguage) {
      this.deps.repo.updateOfflineMetadata(
        id,
        {
          subtitleUrl: input.stream.subtitle ?? null,
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

  /** Non-blocking playback surface: one-line summary for the active download matching the current title/episode. */
  describeActiveDownloadForPlayback(input: PlaybackDownloadMatchInput): string | null {
    const job = pickActiveDownloadForPlayback(this.listActive(120), input);
    return job ? formatPlaybackDownloadStripe(job) : null;
  }

  hasActiveJobs(): boolean {
    return this.listActive(1).length > 0;
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
      await this.executeFfmpegDownload(next);
      await this.downloadSubtitleIfAvailable(next);
      await this.persistOutputFileSize(next);
      const completedAt = new Date().toISOString();
      this.deps.repo.complete(next.id, completedAt);
      return this.deps.repo.get(next.id) ?? null;
    } catch (error) {
      const active = this.activeProcesses.get(next.id);
      const cancelled = active?.cancelRequested ?? false;
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      if (cancelled) {
        this.deps.repo.abort(next.id, failedAt);
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
    if (active) {
      active.cancelRequested = true;
      active.process.kill();
      return;
    }
    await rm(job.tempPath, { force: true }).catch(() => {});
    this.deps.repo.abort(jobId, new Date().toISOString());
  }

  private async executeFfmpegDownload(job: DownloadJobRecord): Promise<void> {
    const args = ["-y", "-progress", "pipe:1", "-nostats"];
    const policy = buildDownloadStreamPolicy(job.headers);
    args.push(...policy.ffmpegArgs);
    args.push("-i", job.streamUrl, "-c", "copy", job.tempPath);

    const proc = Bun.spawn(["ffmpeg", ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.activeProcesses.set(job.id, { process: proc, cancelRequested: false });

    const stopHeartbeat = this.startHeartbeat(job.id);

    let durationMs: number | null = null;
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
      const [rawKey, rawValue] = line.split("=", 2);
      if (!rawKey || rawValue === undefined) return;
      if (rawKey !== "out_time_ms" && rawKey !== "progress") return;
      if (rawKey === "progress" && rawValue === "end") {
        persistProgress(99);
        return;
      }
      if (rawKey !== "out_time_ms") return;
      const outTimeMicros = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(outTimeMicros) || outTimeMicros <= 0) return;
      if (durationMs === null) return;
      const percent = (outTimeMicros / 1000 / durationMs) * 100;
      persistProgress(Math.min(99, Math.max(1, percent)));
    });
    const readStderr = readLines(proc.stderr, (line) => {
      stderr = appendBounded(stderr, line, STDERR_MAX_BYTES);
      if (durationMs !== null) return;
      const parsed = parseDurationMs(line);
      if (parsed !== null) {
        durationMs = parsed;
        this.deps.repo.updateOfflineMetadata(
          job.id,
          { durationMs: parsed },
          new Date().toISOString(),
        );
      }
    });
    try {
      const exitCode = await proc.exited;
      await Promise.all([readStdout, readStderr]);

      if (exitCode !== 0 && !this.activeProcesses.get(job.id)?.cancelRequested) {
        throw new Error(stderr.trim() || `ffmpeg exited with code ${exitCode}`);
      }

      if (this.activeProcesses.get(job.id)?.cancelRequested) {
        throw new Error("download aborted");
      }

      await rename(job.tempPath, job.outputPath);
    } finally {
      stopHeartbeat();
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
      const targetPath = resolveSubtitlePath(job);
      const policy = buildDownloadStreamPolicy(job.headers);
      const res = await fetch(job.subtitleUrl, {
        headers: policy.headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return;
      }
      const buffer = new Uint8Array(await res.arrayBuffer());
      await Bun.write(targetPath, buffer);
      this.deps.repo.updateOfflineMetadata(
        job.id,
        { subtitlePath: targetPath },
        new Date().toISOString(),
      );
    } catch {
      // subtitle download is best-effort
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
    for (const runningJob of this.deps.repo.listRunning(200)) {
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
    const configuredBase = this.deps.config.downloadPath.trim();
    const baseDir =
      configuredBase.length > 0
        ? configuredBase
        : join(dirname(getKunaiPaths().dataDbPath), "downloads");
    const titleSlug = slug(input.title.name);
    const suffix =
      input.episode && input.title.type !== "movie"
        ? `-s${String(input.episode.season).padStart(2, "0")}e${String(input.episode.episode).padStart(2, "0")}`
        : "";
    return join(baseDir, `${titleSlug}${suffix}${DOWNLOAD_FILE_EXT}`);
  }
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

function parseDurationMs(line: string): number | null {
  const match = line.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseFloat(match[3] ?? "0");
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds))
    return null;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
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

function analyzeDownloadFailure(message: string): { failureKind: string; retryable: boolean } {
  const normalized = message.toLowerCase();
  if (normalized.includes("download aborted") || normalized.includes("aborted")) {
    return { failureKind: "aborted", retryable: false };
  }
  if (
    normalized.includes("invalid argument") ||
    normalized.includes("unrecognized option") ||
    normalized.includes("option not found")
  ) {
    return { failureKind: "ffmpeg-config", retryable: false };
  }
  if (normalized.includes("protocol not found")) {
    return { failureKind: "protocol", retryable: false };
  }
  if (normalized.includes("server returned 403") || normalized.includes("server returned 401")) {
    return { failureKind: "http-auth", retryable: false };
  }
  if (normalized.includes("http error 4")) {
    return { failureKind: "http-client", retryable: false };
  }
  if (normalized.includes("http error 5")) {
    return { failureKind: "http-server", retryable: true };
  }
  if (normalized.includes("timed out") || normalized.includes("connection")) {
    return { failureKind: "network", retryable: true };
  }
  return { failureKind: "unknown", retryable: true };
}

function appendBounded(current: string, line: string, maxBytes: number): string {
  const next = `${current}${line}\n`;
  if (next.length <= maxBytes) return next;
  return next.slice(next.length - maxBytes);
}

function resolveSubtitleLanguage(stream: StreamInfo): string | null {
  const candidate = stream.subtitleList?.find((track) => track.url === stream.subtitle);
  if (candidate?.language) return candidate.language;
  if (stream.hardSubLanguage) return stream.hardSubLanguage;
  return null;
}

function resolveSubtitlePath(job: DownloadJobRecord): string {
  const base = job.outputPath.replace(/\.[^./]+$/, "");
  return `${base}.srt`;
}
