import type { DiagnosticEventsRepository } from "@kunai/storage";

import type { DiagnosticEvent } from "./diagnostic-event";

export interface DurableDiagnosticsSinkOptions {
  readonly repository: DiagnosticEventsRepository;
  readonly maxQueueSize?: number;
}

const DEFAULT_MAX_QUEUE_SIZE = 1_000;

export class AsyncDurableDiagnosticsSink {
  private readonly maxQueueSize: number;
  private readonly queue: DiagnosticEvent[] = [];
  private scheduled = false;
  private failed = false;

  constructor(private readonly options: DurableDiagnosticsSinkOptions) {
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  enqueue(event: DiagnosticEvent): void {
    if (this.failed) return;

    if (isHighPriorityEvent(event)) {
      this.evictCoalescableProgress();
    }

    if (
      isCoalescableProgressEvent(event) &&
      this.queue.some((queued) => isHighPriorityEvent(queued))
    ) {
      return;
    }

    if (this.coalesceProgressSample(event)) {
      this.scheduleFlush();
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      const dropped = this.dropBackpressureCandidate();
      if (!dropped) {
        if (isCoalescableProgressEvent(event)) return;
        return;
      }
    }

    this.queue.push(event);
    this.scheduleFlush();
  }

  private coalesceProgressSample(event: DiagnosticEvent): boolean {
    if (!isCoalescableProgressEvent(event)) return false;
    const key = progressCoalesceKey(event);
    const existingIndex = this.queue.findIndex(
      (queued) => isCoalescableProgressEvent(queued) && progressCoalesceKey(queued) === key,
    );
    if (existingIndex >= 0) {
      this.queue[existingIndex] = event;
      return true;
    }
    return false;
  }

  private evictCoalescableProgress(): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index];
      if (queued && isCoalescableProgressEvent(queued)) {
        this.queue.splice(index, 1);
      }
    }
  }

  getRecent(limit?: number): readonly DiagnosticEvent[] {
    this.flush();
    return this.options.repository.listRecent(limit) as readonly DiagnosticEvent[];
  }

  getSnapshot(limit?: number): readonly DiagnosticEvent[] {
    this.flush();
    return this.options.repository.getSnapshot(limit) as readonly DiagnosticEvent[];
  }

  flush(): void {
    this.scheduled = false;
    if (this.failed) {
      this.queue.length = 0;
      return;
    }

    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (!event) continue;
      try {
        this.options.repository.insert(event);
      } catch {
        this.failed = true;
        this.queue.length = 0;
        return;
      }
    }

    try {
      this.options.repository.prune();
    } catch {
      this.failed = true;
    }
  }

  clear(): void {
    this.queue.length = 0;
    try {
      this.options.repository.clear();
    } catch {
      this.failed = true;
    }
  }

  private scheduleFlush(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  private dropBackpressureCandidate(): boolean {
    const progressIndex = this.queue.findIndex((event) => isCoalescableProgressEvent(event));
    if (progressIndex >= 0) {
      this.queue.splice(progressIndex, 1);
      return true;
    }

    const lowPriorityIndex = this.queue.findIndex(
      (event) => event.level === "debug" || event.level === "info",
    );
    if (lowPriorityIndex >= 0) {
      this.queue.splice(lowPriorityIndex, 1);
      return true;
    }

    return false;
  }
}

function isCoalescableProgressEvent(event: DiagnosticEvent): boolean {
  if (event.level !== "debug" && event.level !== "info") return false;
  const status = event.context?.status;
  return status === "progress" || event.operation.endsWith(".sample");
}

function isHighPriorityEvent(event: DiagnosticEvent): boolean {
  return event.level === "error" || event.level === "warn";
}

function progressCoalesceKey(event: DiagnosticEvent): string {
  const stage = typeof event.context?.stage === "string" ? event.context.stage : "";
  return `${event.category}:${event.operation}:${stage}`;
}
