// =============================================================================
// Tracer Interface
//
// Distributed tracing for operation tracking.
// =============================================================================

export interface Span {
  readonly id: string;
  readonly name: string;
  readonly startTime: number;
  readonly endTime?: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly events: readonly SpanEvent[];

  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  end(): void;
}

export interface SpanEvent {
  readonly name: string;
  readonly timestamp: number;
  readonly attributes?: Record<string, unknown>;
}

export interface Trace {
  readonly id: string;
  readonly spans: Span[];
}

export interface TracerOptions {
  outputs: ("console" | "file")[];
  logger?: import("../logger/Logger").Logger;
}

export interface Tracer {
  span<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;
  getCurrentTrace(): Trace | null;
  getCurrentSpan(): Span | null;
}
