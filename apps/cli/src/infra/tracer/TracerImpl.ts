// =============================================================================
// Tracer Implementation
//
// Distributed tracing with spans.
// =============================================================================

import type { Tracer, TracerOptions, Span, Trace } from "./Tracer";

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
    return {
      id: Math.random().toString(36).slice(2),
      name,
      startTime: Date.now(),
      setAttribute: (_key: string, _value: unknown) => {
        // Attributes would be stored here
      },
      addEvent: (name: string, attributes?: Record<string, unknown>) => {
        this.options.logger?.debug(`[${name}]`, attributes);
      },
      end: () => {
        // End span
      },
    };
  }

  private pushSpan(span: Span): void {
    this.spanStack.push(span);
    this.currentSpan = span;
  }

  private popSpan(): void {
    this.spanStack.pop();
    this.currentSpan = this.spanStack[this.spanStack.length - 1] ?? null;
  }
}
