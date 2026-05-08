import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { EpisodeInfo, StreamInfo, TitleInfo } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { getKunaiPaths, type DownloadJobRecord, type DownloadJobsRepository } from "@kunai/storage";

import { resolveDownloadFeatureState } from "./DownloadFeature";

const DOWNLOAD_FILE_EXT = ".mp4";

export type EnqueueDownloadInput = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly stream: StreamInfo;
  readonly providerId: string;
};

export class DownloadService {
  constructor(
    private readonly deps: {
      readonly repo: DownloadJobsRepository;
      readonly config: ConfigService;
      readonly logger: Logger;
      readonly ffmpegAvailable: boolean;
    },
  ) {}

  async enqueue(input: EnqueueDownloadInput): Promise<DownloadJobRecord> {
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

    const created = this.deps.repo.get(id);
    if (!created) {
      throw new Error("Download enqueue failed");
    }
    return created;
  }

  listCompleted(limit = 100): readonly DownloadJobRecord[] {
    return this.deps.repo.listCompleted(limit);
  }

  async processNextQueued(): Promise<DownloadJobRecord | null> {
    const feature = resolveDownloadFeatureState({
      config: this.deps.config,
      capabilities: { ffmpeg: this.deps.ffmpegAvailable },
    });
    if (!feature.usable) {
      return null;
    }

    const next = this.deps.repo.listQueued(1)[0];
    if (!next) {
      return null;
    }

    const now = new Date().toISOString();
    this.deps.repo.markRunning(next.id, now);

    try {
      await this.executeFfmpegDownload(next);
      const completedAt = new Date().toISOString();
      this.deps.repo.complete(next.id, completedAt);
      return this.deps.repo.get(next.id) ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.repo.fail(next.id, message, true, new Date().toISOString());
      await rm(next.tempPath, { force: true }).catch(() => {});
      this.deps.logger.warn("Download failed", { jobId: next.id, error: message });
      return this.deps.repo.get(next.id) ?? null;
    }
  }

  async abort(jobId: string): Promise<void> {
    const job = this.deps.repo.get(jobId);
    if (!job) {
      return;
    }
    await rm(job.tempPath, { force: true }).catch(() => {});
    this.deps.repo.abort(jobId, new Date().toISOString());
  }

  private async executeFfmpegDownload(job: DownloadJobRecord): Promise<void> {
    const args = ["-y"];
    for (const [key, value] of Object.entries(job.headers)) {
      args.push("-headers", `${key}: ${value}\r\n`);
    }
    args.push("-i", job.streamUrl, "-c", "copy", job.tempPath);

    const proc = Bun.spawn(["ffmpeg", ...args], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `ffmpeg exited with code ${exitCode}`);
    }

    await rename(job.tempPath, job.outputPath);
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
