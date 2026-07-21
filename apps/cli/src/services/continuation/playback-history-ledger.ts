import { ENGAGE_SECONDS, isDidNotStartProgress } from "@/domain/playback/progress-engage-policy";
import type { HistoryRepository, PlaybackEventRepository } from "@kunai/storage";
import type { EpisodeIdentity, MediaKind, ProviderId, TitleIdentity } from "@kunai/types";

const CHECKPOINT_INTERVAL_MS = 30_000;

export type PlaybackHistoryLedgerContext = {
  readonly title: TitleIdentity;
  readonly episode?: EpisodeIdentity;
  readonly providerId?: ProviderId;
  readonly posterUrl?: string;
  readonly mediaKind: MediaKind;
};

/**
 * Tracks engaged watch seconds during an mpv session and checkpoints to SQLite.
 * Events are fire-and-forget inserts into playback_events.
 */
export class PlaybackHistoryLedger {
  private context: PlaybackHistoryLedgerContext | null = null;
  private lastPositionSeconds = 0;
  private engagedSeconds = 0;
  private paused = false;
  private lastCheckpointAt = 0;
  private durationSeconds = 0;

  constructor(
    private readonly historyRepository: HistoryRepository,
    private readonly playbackEvents: PlaybackEventRepository,
  ) {}

  alignProvider(providerId: ProviderId): void {
    if (!this.context) return;
    this.context = { ...this.context, providerId };
  }

  start(context: PlaybackHistoryLedgerContext, startAtSeconds: number): void {
    this.context = context;
    this.lastPositionSeconds = Math.max(0, startAtSeconds);
    this.engagedSeconds = this.readExistingWatchedSeconds(context);
    this.paused = false;
    this.lastCheckpointAt = Date.now();
    this.durationSeconds = 0;
    this.recordEvent("start", { positionSeconds: this.lastPositionSeconds });
  }

  onProgress(positionSeconds: number, durationSeconds: number): void {
    if (!this.context) return;
    this.durationSeconds = durationSeconds;
    if (!this.paused && positionSeconds > this.lastPositionSeconds) {
      this.engagedSeconds += positionSeconds - this.lastPositionSeconds;
    }
    this.lastPositionSeconds = positionSeconds;
    this.recordEvent("progress", { positionSeconds, durationSeconds });
    const now = Date.now();
    if (now - this.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
      this.checkpoint();
      this.lastCheckpointAt = now;
    }
  }

  onPaused(positionSeconds: number, durationSeconds: number): void {
    this.paused = true;
    this.lastPositionSeconds = positionSeconds;
    this.durationSeconds = durationSeconds;
    this.recordEvent("pause", { positionSeconds, durationSeconds });
    this.checkpoint();
  }

  onResumed(positionSeconds: number, durationSeconds: number): void {
    this.paused = false;
    this.lastPositionSeconds = positionSeconds;
    this.durationSeconds = durationSeconds;
    this.recordEvent("resume", { positionSeconds, durationSeconds });
  }

  onSeek(positionSeconds: number, durationSeconds: number): void {
    this.lastPositionSeconds = positionSeconds;
    this.durationSeconds = durationSeconds;
    this.recordEvent("seek", { positionSeconds, durationSeconds });
  }

  finalize(input: {
    readonly positionSeconds: number;
    readonly durationSeconds: number;
    readonly completed: boolean;
    readonly providerId?: ProviderId;
    readonly posterUrl?: string;
    readonly bumpLastWatched?: boolean;
  }): void {
    if (!this.context) return;
    this.durationSeconds = input.durationSeconds;
    this.lastPositionSeconds = input.positionSeconds;
    if (input.completed && input.durationSeconds > 0) {
      this.engagedSeconds = Math.max(this.engagedSeconds, input.durationSeconds);
    } else {
      this.engagedSeconds = Math.max(this.engagedSeconds, input.positionSeconds);
    }
    const now = new Date().toISOString();
    const bumpLastWatched = input.bumpLastWatched ?? true;
    const existing = this.historyRepository.getProgress(this.context.title, this.context.episode);
    const isDnsFinalize = input.positionSeconds <= 0 && input.durationSeconds > 0;
    const existingResumeSeconds = existing?.positionSeconds ?? 0;
    const positionSeconds =
      bumpLastWatched === false && isDnsFinalize && existingResumeSeconds > 0
        ? existingResumeSeconds
        : input.positionSeconds;
    const lastWatchedAt = bumpLastWatched
      ? now
      : (existing?.lastWatchedAt ?? existing?.updatedAt ?? null);
    this.recordEvent("complete", {
      positionSeconds,
      durationSeconds: input.durationSeconds,
    });
    this.historyRepository.upsertProgress({
      title: this.context.title,
      episode: this.context.episode,
      positionSeconds,
      durationSeconds: input.durationSeconds,
      completed: input.completed,
      watchedSeconds: this.engagedSeconds,
      lastWatchedAt,
      completedAt: input.completed ? now : null,
      providerId: input.providerId ?? this.context.providerId,
      posterUrl: input.posterUrl ?? this.context.posterUrl,
      updatedAt: now,
    });
    this.context = null;
  }

  /**
   * Drop ledger state without persisting — used when history save is skipped,
   * aborted, or rejected (short / DNS sessions). Idempotent. After discard,
   * registered shutdown checkpoints must not write history.
   */
  discard(): void {
    this.context = null;
    this.lastPositionSeconds = 0;
    this.engagedSeconds = 0;
    this.paused = false;
    this.lastCheckpointAt = 0;
    this.durationSeconds = 0;
  }

  /** @deprecated Prefer {@link discard}. */
  abandon(): void {
    this.discard();
  }

  checkpoint(): void {
    if (!this.context) return;
    const existing = this.historyRepository.getProgress(this.context.title, this.context.episode);
    const isDnsCheckpoint = isDidNotStartProgress({
      trustedProgressSeconds: this.lastPositionSeconds,
      durationSeconds: this.durationSeconds,
    });
    if (isDnsCheckpoint) {
      if ((existing?.positionSeconds ?? 0) > 0) {
        return;
      }
      if (!existing) {
        return;
      }
    }
    const now = new Date().toISOString();
    const shouldBumpLastWatched = this.lastPositionSeconds > ENGAGE_SECONDS;
    const lastWatchedAt = shouldBumpLastWatched ? now : (existing?.lastWatchedAt ?? null);
    this.historyRepository.checkpointProgress({
      title: this.context.title,
      episode: this.context.episode,
      positionSeconds: this.lastPositionSeconds,
      durationSeconds: this.durationSeconds > 0 ? this.durationSeconds : undefined,
      watchedSeconds: this.engagedSeconds,
      lastWatchedAt,
      providerId: this.context.providerId,
      posterUrl: this.context.posterUrl,
      updatedAt: now,
    });
  }

  private readExistingWatchedSeconds(context: PlaybackHistoryLedgerContext): number {
    const existing = this.historyRepository.getProgress(context.title, context.episode);
    return existing?.watchedSeconds ?? 0;
  }

  private recordEvent(
    eventType: "start" | "progress" | "pause" | "resume" | "seek" | "complete",
    input: { positionSeconds?: number; durationSeconds?: number },
  ): void {
    if (!this.context) return;
    try {
      this.playbackEvents.insert({
        eventType,
        titleId: this.context.title.id,
        mediaKind: this.context.mediaKind,
        season: this.context.episode?.season,
        episode: this.context.episode?.episode,
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        providerId: this.context.providerId,
      });
    } catch {
      // Fire-and-forget — never block playback on event persistence.
    }
  }
}
