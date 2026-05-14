// =============================================================================
// Tracer Implementation
//
// Distributed tracing with spans.
// =============================================================================

import type { Tracer, TracerOptions, Span, Trace } from "./Tracer";

class RuntimeSpan implements Span {
  readonly id = Math.random().toString(36).slice(2);
  readonly startTime: number;
  endTime?: number;
  readonly attributes: Record<string, unknown> = {};
  readonly events: Span["events"] = [];

  constructor(
    readonly name: string,
    private readonly logger?: TracerOptions["logger"],
    private readonly now: () => number = Date.now,
  ) {
    this.startTime = now();
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    const event = { name, timestamp: this.now(), attributes };
    (this.events as (typeof event)[]).push(event);
    this.logger?.debug(`[${name}]`, attributes);
  }

  end(): void {
    if (this.endTime !== undefined) return;
    this.endTime = this.now();
  }
}

export class TracerImpl implements Tracer {
  private currentTrace: Trace | null = null;
  private currentSpan: Span | null = null;
  private spanStack: Span[] = [];

  constructor(private options: TracerOptions) {}

  async span<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const span = this.createSpan(name);
    this.pushSpan(span);

    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (e) {
      span.addEvent("error", { message: String(e) });
      span.end();
      throw e;
    } finally {
      this.popSpan();
    }
  }

  getCurrentTrace(): Trace | null {
    return this.currentTrace;
  }

  getCurrentSpan(): Span | null {
    return this.currentSpan;
  }

  private createSpan(name: string): Span {
    const span = new RuntimeSpan(name, this.options.logger);
    const trace = this.currentTrace ?? { id: Math.random().toString(36).slice(2), spans: [] };
    trace.spans.push(span);
    this.currentTrace = trace;
    return span;
  }

  private pushSpan(span: Span): void {
    this.spanStack.push(span);
    this.currentSpan = span;
  }

  private popSpan(): void {
    this.spanStack.pop();
    this.currentSpan = this.spanStack[this.spanStack.length - 1] ?? null;
    if (!this.currentSpan) {
      this.currentTrace = null;
    }
  }
}
