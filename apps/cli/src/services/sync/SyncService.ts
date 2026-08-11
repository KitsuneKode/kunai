import type { HistoryProgress, SyncQueueErrorKind, SyncQueueRepository } from "@kunai/storage";

import type { DiagnosticsService } from "../diagnostics/DiagnosticsService";
import { syncDedupeKey } from "./sync-identity";
import type { SyncAdapter } from "./SyncAdapter";
import type { SyncOutcome, TrackerListItem, TrackerProgress } from "./types";

export type SyncHealth = "ok" | "warn" | "error" | "disconnected";

export interface SyncPushSummary {
  readonly connected: number;
  readonly succeeded: number;
  readonly skipped: number;
  readonly failed: number;
  readonly queued: number;
  readonly failures: readonly string[];
  readonly notes: readonly string[];
}

/** Per-adapter toggles, mirrored from `config.sync`. */
export interface SyncConfigGate {
  readonly enabled: boolean;
  readonly trackWatched: boolean;
  readonly syncList: boolean;
}

export interface SyncConfigPort {
  readonly sync: Readonly<Record<"anilist" | "tmdb", SyncConfigGate>>;
}

export interface SyncServiceDeps {
  readonly adapters: readonly SyncAdapter[];
  readonly queue: SyncQueueRepository;
  readonly config: SyncConfigPort;
  readonly diagnostics?: Pick<DiagnosticsService, "record">;
}

/** Queued payload shape. Kept flat and versioned-by-shape for forward reads. */
interface QueuedProgressPayload {
  readonly kind: "progress";
  readonly progress: TrackerProgress;
}

interface QueuedListPayload {
  readonly kind: "list";
  readonly item: TrackerListItem;
}

type QueuedPayload = QueuedProgressPayload | QueuedListPayload;

function isQueuedPayload(value: unknown): value is QueuedPayload {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "progress" || kind === "list";
}

/** Project a history row into the tracker-facing progress shape. */
export function trackerProgressFromHistory(entry: HistoryProgress): TrackerProgress {
  return {
    titleId: entry.titleId,
    title: entry.title,
    mediaKind: entry.mediaKind,
    ...(entry.externalIds ? { externalIds: entry.externalIds } : {}),
    ...(entry.season !== undefined ? { season: entry.season } : {}),
    ...(entry.episode !== undefined ? { episode: entry.episode } : {}),
    ...(entry.absoluteEpisode !== undefined ? { absoluteEpisode: entry.absoluteEpisode } : {}),
    completed: entry.completed,
    ...(entry.lastWatchedAt ? { watchedAt: entry.lastWatchedAt } : {}),
  };
}

/**
 * Tracker sync orchestration.
 *
 * Responsibilities that deliberately live here rather than in the adapters:
 *
 *  - **Durability.** Every push goes through the SQLite outbox first, so a
 *    scrobble that fails because the laptop lid closed mid-episode is retried
 *    on the next launch instead of being lost. Adapters stay stateless.
 *  - **Gating.** `config.sync.<adapter>` decides whether an adapter is asked at
 *    all. These flags previously existed but nothing read them.
 *  - **Routing.** Only adapters that can represent a write are asked to perform
 *    it, so TMDB is never blamed for lacking an episode-progress API.
 */
export class SyncService {
  private lastRunHadFailures = false;
  /** Serializes drains; see `drain`. */
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SyncServiceDeps) {}

  get adapters(): readonly SyncAdapter[] {
    return this.deps.adapters;
  }

  getAdapter(id: string): SyncAdapter | undefined {
    return this.deps.adapters.find((adapter) => adapter.id === id);
  }

  getConnectedAdapters(): SyncAdapter[] {
    return this.deps.adapters.filter((adapter) => adapter.isConnected());
  }

  /** Adapters that are connected, enabled in config, and allowed to scrobble. */
  private progressTargets(): SyncAdapter[] {
    return this.deps.adapters.filter((adapter) => {
      if (!adapter.capabilities.episodeProgress) return false;
      if (!adapter.isConnected()) return false;
      const gate = this.deps.config.sync[adapter.id];
      return gate?.enabled === true && gate.trackWatched === true;
    });
  }

  private listTargets(): SyncAdapter[] {
    return this.deps.adapters.filter((adapter) => {
      if (!adapter.capabilities.lists || !adapter.pushListItem) return false;
      if (!adapter.isConnected()) return false;
      const gate = this.deps.config.sync[adapter.id];
      return gate?.enabled === true && gate.syncList === true;
    });
  }

  getHealth(): SyncHealth {
    const connected = this.getConnectedAdapters();
    const needsReauth = this.deps.adapters.some(
      (adapter) => adapter.getConnection().state === "needs-reauth",
    );
    if (needsReauth) return "error";
    if (connected.length === 0) return "disconnected";

    let dead = 0;
    let pending = 0;
    try {
      dead = this.deps.queue.deadCount();
      pending = this.deps.queue.pendingCount();
    } catch {
      // A storage read must never take the header down.
    }
    if (dead > 0) return "error";
    if (pending > 0 || this.lastRunHadFailures) return "warn";
    return "ok";
  }

  getQueueStatus(): { readonly pending: number; readonly dead: number } {
    try {
      return { pending: this.deps.queue.pendingCount(), dead: this.deps.queue.deadCount() };
    } catch {
      return { pending: 0, dead: 0 };
    }
  }

  /**
   * Fire-and-forget scrobble, called at episode boundaries.
   *
   * Enqueues first and drains after, so the push survives a crash between the
   * episode ending and the network call completing. Never throws and never
   * blocks playback — an episode boundary is latency-critical.
   */
  trackerPush(entry: HistoryProgress): void {
    const targets = this.progressTargets();
    if (targets.length === 0) return;

    const progress = trackerProgressFromHistory(entry);
    const dedupeKey = syncDedupeKey({
      titleId: progress.titleId,
      ...(progress.season !== undefined ? { season: progress.season } : {}),
      ...(progress.episode !== undefined ? { episode: progress.episode } : {}),
    });

    for (const adapter of targets) {
      try {
        this.deps.queue.enqueue({
          adapterId: adapter.id,
          dedupeKey,
          payload: { kind: "progress", progress } satisfies QueuedProgressPayload,
        });
      } catch (error) {
        this.record("sync.enqueue.failed", { adapterId: adapter.id, error: String(error) });
      }
    }

    void this.drain().catch(() => undefined);
  }

  /** Mirror a list membership change upstream (watchlist / favourites). */
  pushListItem(item: TrackerListItem): void {
    const targets = this.listTargets();
    if (targets.length === 0) return;

    for (const adapter of targets) {
      try {
        this.deps.queue.enqueue({
          adapterId: adapter.id,
          dedupeKey: `list|${item.listKind}|${item.titleId}`,
          payload: { kind: "list", item } satisfies QueuedListPayload,
        });
      } catch (error) {
        this.record("sync.enqueue.failed", { adapterId: adapter.id, error: String(error) });
      }
    }

    void this.drain().catch(() => undefined);
  }

  /**
   * Work the outbox: every row whose backoff has elapsed, once.
   *
   * Drains are *serialized, not dropped*. AniList rate-limits per account, so
   * overlapping passes are wasteful — but a caller that asks for a drain must
   * still observe a real pass. Returning early while another drain is in flight
   * would let "Sync now" report "everything up to date" for work it never
   * looked at.
   */
  async drain(limit = 25): Promise<SyncPushSummary> {
    const next = this.chain.then(
      () => this.drainOnce(limit),
      () => this.drainOnce(limit),
    );
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /**
   * Resolve once no drain is in flight. Used by tests and by shutdown to flush
   * a scrobble that was fired at an episode boundary.
   */
  async whenIdle(): Promise<void> {
    await this.chain;
  }

  private async drainOnce(limit: number): Promise<SyncPushSummary> {
    let due: ReturnType<SyncQueueRepository["listDue"]>;
    try {
      due = this.deps.queue.listDue(limit);
    } catch (error) {
      this.record("sync.queue.read-failed", { error: String(error) });
      due = [];
    }

    const connected = this.getConnectedAdapters();
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    const failures: string[] = [];
    const notes: string[] = [];

    for (const row of due) {
      const adapter = this.getAdapter(row.adapterId);

      // The adapter was disconnected after the row was queued: the write can
      // never land, so drop it rather than retrying until it dies.
      if (!adapter || !adapter.isConnected()) {
        this.deps.queue.remove(row.id);
        continue;
      }

      if (!isQueuedPayload(row.payload)) {
        this.deps.queue.remove(row.id);
        continue;
      }

      const outcome = await this.applyPayload(adapter, row.payload);

      if (outcome.status === "ok") {
        succeeded += 1;
        if (outcome.detail) notes.push(`${adapter.displayName}: ${outcome.detail}`);
        this.deps.queue.remove(row.id);
        continue;
      }

      if (outcome.status === "skipped") {
        // Structural no-op — never retry it.
        skipped += 1;
        this.deps.queue.remove(row.id);
        continue;
      }

      failed += 1;
      failures.push(`${adapter.displayName}: ${outcome.error}`);
      this.deps.queue.recordFailure(row.id, outcome.error, outcome.kind as SyncQueueErrorKind);
      this.record("sync.push.failed", {
        adapterId: adapter.id,
        kind: outcome.kind,
        attempts: row.attempts + 1,
        error: outcome.error,
      });
    }

    this.lastRunHadFailures = failed > 0;

    let queued = 0;
    try {
      queued = this.deps.queue.pendingCount();
    } catch {
      queued = 0;
    }

    return { connected: connected.length, succeeded, skipped, failed, queued, failures, notes };
  }

  private async applyPayload(adapter: SyncAdapter, payload: QueuedPayload): Promise<SyncOutcome> {
    try {
      if (payload.kind === "progress") {
        return await adapter.pushProgress(payload.progress);
      }
      if (!adapter.pushListItem) {
        return { status: "skipped", reason: `${adapter.displayName} has no writable lists.` };
      }
      return await adapter.pushListItem(payload.item);
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        kind: "unknown",
      };
    }
  }

  /**
   * Manual "Sync now": re-queue recent history, clear every backoff (including
   * rows that had exhausted their attempts), and drain.
   */
  async syncNow(entries: readonly HistoryProgress[]): Promise<SyncPushSummary> {
    for (const entry of entries) this.trackerPush(entry);
    try {
      this.deps.queue.resetAll();
    } catch {
      // Non-fatal: the drain below still processes anything already due.
    }
    return this.drain(100);
  }

  /**
   * Pull remote lists and return what each adapter reports. Reconciliation into
   * Kunai lists is the caller's job — this service does not own list storage.
   */
  async pull(
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<Readonly<Record<string, Awaited<ReturnType<NonNullable<SyncAdapter["pullList"]>>>>>> {
    const results: Record<string, Awaited<ReturnType<NonNullable<SyncAdapter["pullList"]>>>> = {};
    for (const adapter of this.deps.adapters) {
      if (!adapter.pullList || !adapter.isConnected()) continue;
      const gate = this.deps.config.sync[adapter.id];
      if (gate?.enabled !== true || gate.syncList !== true) continue;
      try {
        results[adapter.id] = await adapter.pullList(options);
      } catch (error) {
        this.record("sync.pull.failed", { adapterId: adapter.id, error: String(error) });
      }
    }
    return results;
  }

  /** Drop queued work for an adapter the user just disconnected. */
  forgetAdapterQueue(adapterId: string): void {
    try {
      this.deps.queue.removeForAdapter(adapterId);
    } catch {
      // Best effort.
    }
  }

  private record(operation: string, context: Record<string, unknown>): void {
    this.deps.diagnostics?.record({
      category: "runtime",
      operation,
      message: "Tracker sync",
      context,
    });
  }
}
