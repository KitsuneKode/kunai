// =============================================================================
// Tracer Interface
//
// Distributed tracing for operation tracking.
// =============================================================================

export interface Span {
  readonly id: string;
  readonly name: string;
  readonly startTime: number;
  
  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  end(): void;
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
