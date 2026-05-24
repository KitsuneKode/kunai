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

export class BackgroundWorkScheduler {
  private readonly queue = new Map<string, BackgroundWorkItem>();
  private drainInFlight?: Promise<BackgroundWorkDrainResult>;

  constructor(
    private readonly options: {
      readonly maxConcurrent?: number;
    } = {},
  ) {}

  enqueue(item: BackgroundWorkItem): void {
    this.queue.set(item.id, item);
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

  private async drainQueue(): Promise<BackgroundWorkDrainResult> {
    const completed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const skipped: { id: string; reason: "aborted" }[] = [];
    const maxConcurrent = Math.max(1, Math.trunc(this.options.maxConcurrent ?? 1));

    while (this.queue.size > 0) {
      const batch = this.takeNextBatch(maxConcurrent);
      await Promise.all(
        batch.map(async (item) => {
          if (item.signal?.aborted) {
            skipped.push({ id: item.id, reason: "aborted" });
            return;
          }

          const controller = new AbortController();
          const relayAbort = () => controller.abort(item.signal?.reason);
          item.signal?.addEventListener("abort", relayAbort, { once: true });
          try {
            await item.run(controller.signal);
            if (item.signal?.aborted || controller.signal.aborted) {
              skipped.push({ id: item.id, reason: "aborted" });
              return;
            }
            completed.push(item.id);
          } catch (error) {
            if (item.signal?.aborted || controller.signal.aborted || isAbortLike(error)) {
              skipped.push({ id: item.id, reason: "aborted" });
              return;
            }
            failed.push({
              id: item.id,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            item.signal?.removeEventListener("abort", relayAbort);
          }
        }),
      );
    }

    return { completed, failed, skipped };
  }

  private takeNextBatch(count: number): BackgroundWorkItem[] {
    const items = [...this.queue.values()].sort(
      (a, b) => LANE_PRIORITY[b.lane] - LANE_PRIORITY[a.lane] || a.id.localeCompare(b.id),
    );
    const batch = items.slice(0, count);
    for (const item of batch) {
      this.queue.delete(item.id);
    }
    return batch;
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
