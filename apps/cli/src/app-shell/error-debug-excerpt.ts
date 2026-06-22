export type ErrorDebugExcerpt = {
  readonly message: string;
  readonly topFrame: string | null;
};

function firstStackFrame(stack: string): string | null {
  const lines = stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const frame = lines.find((line) => line.startsWith("at "));
  return frame ?? null;
}

/** Extract message + top stack frame from an error object (no filesystem reads). */
export function extractErrorDebugExcerpt(error: unknown): ErrorDebugExcerpt | null {
  if (!(error instanceof Error)) return null;
  const message = error.message.trim();
  if (!message) return null;
  return {
    message,
    topFrame: error.stack ? firstStackFrame(error.stack) : null,
  };
}
