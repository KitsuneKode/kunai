import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";

export type BackgroundWorkLane =
  | "playback-critical"
  | "next-episode-prefetch"
  | "user-requested-download"
  | "offline-runway"
  | "recommendation-warm"
  | "attention-refresh"
  | "maintenance-cleanup";

export type BackgroundWorkItem = {
  readonly id: string;
  readonly lane: BackgroundWorkLane;
  readonly signal?: AbortSignal;
  readonly run: (signal: AbortSignal) => Promise<void> | void;
};

export type BackgroundWorkDrainResult = {
  readonly completed: readonly string[];
  readonly failed: readonly { readonly id: string; readonly error: string }[];
  readonly skipped: readonly { readonly id: string; readonly reason: "aborted" }[];
};

const LANE_PRIORITY: Record<BackgroundWorkLane, number> = {
  "playback-critical": 100,
  "next-episode-prefetch": 80,
  "user-requested-download": 70,
  "offline-runway": 60,
  "recommendation-warm": 40,
  "attention-refresh": 30,
  "maintenance-cleanup": 10,
};

type LaneDrainStats = {
  completed: number;
  failed: number;
  skipped: number;
};

export class BackgroundWorkScheduler {
  private readonly queue = new Map<string, BackgroundWorkItem>();
  private drainInFlight?: Promise<BackgroundWorkDrainResult>;
  private readonly activeControllers = new Set<AbortController>();
  private shuttingDown = false;
  /**
   * Lazily sorted view of `queue`. Rebuilt only after a mutation (enqueue or
   * batch take), so a drain pays one sort — not one per batch — while items
   * enqueued mid-drain are still picked up by later batches.
   */
  private sortedSnapshot: BackgroundWorkItem[] | undefined;

  constructor(
    private readonly options: {
      readonly maxConcurrent?: number;
      readonly diagnostics?: Pick<DiagnosticsService, "record">;
      /**
       * Queue admission bound. Prefetch/warm/runway bursts otherwise grow the
       * map without backpressure for the life of the process. Past the bound
       * the lowest-priority oldest item gives way (same-id re-enqueue still
       * coalesces, so refresh bursts collapse instead of shedding).
       */
      readonly maxQueued?: number;
    } = {},
  ) {}

  /** Returns false (and drops the item) once shutdown has begun. */
  enqueue(item: BackgroundWorkItem): boolean {
    if (this.shuttingDown) return false;
    const maxQueued = Math.max(1, Math.trunc(this.options.maxQueued ?? 500));
    if (!this.queue.has(item.id) && this.queue.size >= maxQueued) {
      this.evictLowestPriority(item);
    }
    this.queue.set(item.id, item);
    this.sortedSnapshot = undefined;
    return true;
  }

  /**
   * Close work admission and abort active items. Queued-but-unstarted items
   * drain as skipped. Idempotent; never throws so teardown callers stay safe.
   */
  beginShutdown(reason: "container-dispose" | "app-exit" = "container-dispose"): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.recordShutdown(reason);
    for (const controller of this.activeControllers) {
      controller.abort(new Error(`background work aborted: ${reason}`));
    }
  }

  pendingCount(): number {
    return this.queue.size;
  }

  async drain(): Promise<BackgroundWorkDrainResult> {
    if (this.drainInFlight) {
      await this.drainInFlight;
      return emptyDrainResult();
    }

    this.drainInFlight = this.drainQueue();
    try {
      return await this.drainInFlight;
    } finally {
      this.drainInFlight = undefined;
    }
  }

  recordShutdown(reason: "container-dispose" | "app-exit" = "container-dispose"): void {
    this.options.diagnostics?.record({
      level: "debug",
      category: "runtime",
      operation: "background.work.shutdown",
      message: "Background work scheduler shutting down",
      context: {
        reason,
        pendingCount: this.pendingCount(),
      },
    });
  }

  private async drainQueue(): Promise<BackgroundWorkDrainResult> {
    const completed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const skipped: { id: string; reason: "aborted" }[] = [];
    const laneStats = new Map<BackgroundWorkLane, LaneDrainStats>();
    const itemLanes = new Map<string, BackgroundWorkLane>();
    const maxConcurrent = Math.max(1, Math.trunc(this.options.maxConcurrent ?? 1));

    const noteLane = (lane: BackgroundWorkLane, outcome: keyof LaneDrainStats) => {
      const stats = laneStats.get(lane) ?? { completed: 0, failed: 0, skipped: 0 };
      stats[outcome] += 1;
      laneStats.set(lane, stats);
    };

    while (this.queue.size > 0) {
      const batch = this.takeNextBatch(maxConcurrent);
      for (const item of batch) {
        itemLanes.set(item.id, item.lane);
      }
      await Promise.all(
        batch.map(async (item) => {
          if (item.signal?.aborted || this.shuttingDown) {
            skipped.push({ id: item.id, reason: "aborted" });
            noteLane(item.lane, "skipped");
            return;
          }

          const controller = new AbortController();
          this.activeControllers.add(controller);
          const relayAbort = () => controller.abort(item.signal?.reason);
          item.signal?.addEventListener("abort", relayAbort, { once: true });
          try {
            await item.run(controller.signal);
            if (item.signal?.aborted || controller.signal.aborted) {
              skipped.push({ id: item.id, reason: "aborted" });
              noteLane(item.lane, "skipped");
              return;
            }
            completed.push(item.id);
            noteLane(item.lane, "completed");
          } catch (error) {
            if (item.signal?.aborted || controller.signal.aborted || isAbortLike(error)) {
              skipped.push({ id: item.id, reason: "aborted" });
              noteLane(item.lane, "skipped");
              return;
            }
            failed.push({
              id: item.id,
              error: error instanceof Error ? error.message : String(error),
            });
            noteLane(item.lane, "failed");
          } finally {
            this.activeControllers.delete(controller);
            item.signal?.removeEventListener("abort", relayAbort);
          }
        }),
      );
    }

    const result = { completed, failed, skipped };
    this.recordDrainDiagnostics(laneStats, result, itemLanes);
    return result;
  }

  private recordDrainDiagnostics(
    laneStats: Map<BackgroundWorkLane, LaneDrainStats>,
    result: BackgroundWorkDrainResult,
    itemLanes: Map<string, BackgroundWorkLane>,
  ): void {
    if (!this.options.diagnostics || laneStats.size === 0) return;

    for (const [lane, stats] of laneStats) {
      this.options.diagnostics.record({
        level: "debug",
        category: "runtime",
        operation: "background.work.drain",
        message: `Background lane drained: ${lane}`,
        context: {
          lane,
          completed: stats.completed,
          failed: stats.failed,
          skipped: stats.skipped,
        },
      });
    }

    if (result.failed.length > 0) {
      this.options.diagnostics.record({
        level: "warn",
        category: "runtime",
        operation: "background.work.drain",
        message: "Background work drain finished with failures",
        context: {
          lanes: [...laneStats.keys()],
          failed: result.failed.map((entry) => ({
            id: entry.id,
            lane: itemLanes.get(entry.id),
            error: entry.error,
          })),
        },
      });
    }
  }

  private takeNextBatch(count: number): BackgroundWorkItem[] {
    this.sortedSnapshot ??= [...this.queue.values()].sort(
      (a, b) => LANE_PRIORITY[b.lane] - LANE_PRIORITY[a.lane] || a.id.localeCompare(b.id),
    );
    const batch = this.sortedSnapshot.slice(0, count);
    for (const item of batch) {
      this.queue.delete(item.id);
    }
    this.sortedSnapshot = this.sortedSnapshot.slice(count);
    return batch;
  }

  /**
   * Shed load on overflow: the lowest-priority oldest item is dropped so a
   * burst of low-value work (recommendation warm, attention refresh) can
   * never starve playback-critical or user-requested items. The drop is
   * recorded — silent shedding would be the house silent-no-op failure.
   */
  private evictLowestPriority(incoming: BackgroundWorkItem): void {
    let victim: BackgroundWorkItem | undefined;
    for (const item of this.queue.values()) {
      // Strictly-lower wins, so ties keep the earliest-inserted victim:
      // Map iterates in insertion order.
      if (!victim || LANE_PRIORITY[item.lane] < LANE_PRIORITY[victim.lane]) {
        victim = item;
      }
    }
    if (!victim) return;
    this.queue.delete(victim.id);
    this.options.diagnostics?.record({
      level: "debug",
      category: "runtime",
      operation: "background.work.shed",
      message: "Background work queue full; shed lowest-priority item",
      context: {
        shedId: victim.id,
        shedLane: victim.lane,
        admittedId: incoming.id,
        admittedLane: incoming.lane,
      },
    });
  }
}

function emptyDrainResult(): BackgroundWorkDrainResult {
  return { completed: [], failed: [], skipped: [] };
}

function isAbortLike(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}
