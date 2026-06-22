let lastCapturedPlaybackError: unknown = null;

export function capturePlaybackShellError(error: unknown): void {
  lastCapturedPlaybackError = error;
}

export function peekPlaybackShellError(): unknown {
  return lastCapturedPlaybackError;
}

export function clearPlaybackShellError(): void {
  lastCapturedPlaybackError = null;
}
