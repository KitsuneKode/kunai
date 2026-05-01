// =============================================================================
// Phase Interface
//
// Base contract for all application phases.
// =============================================================================

import type { Container } from "../container";
import type { KitsuneError } from "../domain/errors";

export type PhaseResult<T> =
  | { status: "success"; value: T }
  | { status: "error"; error: KitsuneError }
  | { status: "cancelled" }
  | { status: "quit" };

export interface PhaseContext {
  container: Container;
  signal: AbortSignal;
}

export interface Phase<TInput, TOutput> {
  readonly name: string;
  execute(input: TInput, context: PhaseContext): Promise<PhaseResult<TOutput>>;
}
