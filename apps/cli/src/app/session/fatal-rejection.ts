const FATAL_REJECTION = Symbol.for("kunai.fatalRejection");

/**
 * Mark a rejection as the playback main flow. `main.ts` shuts down on it.
 * Every other unhandled rejection is background work and is logged only.
 */
export function markFatalRejection(reason: unknown): unknown {
  if (reason !== null && (typeof reason === "object" || typeof reason === "function")) {
    Object.defineProperty(reason, FATAL_REJECTION, { value: true });
    return reason;
  }
  const wrapped = new Error(typeof reason === "string" ? reason : "Fatal playback rejection");
  Object.defineProperty(wrapped, FATAL_REJECTION, { value: true });
  if (reason !== undefined) (wrapped as Error & { cause?: unknown }).cause = reason;
  return wrapped;
}

export function isFatalRejection(reason: unknown): boolean {
  return (
    reason !== null &&
    (typeof reason === "object" || typeof reason === "function") &&
    FATAL_REJECTION in reason
  );
}
