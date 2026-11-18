/** Interactive browse search abort scope — independent of type-ahead cancellation. */
export function createBrowseSearchAbort(phaseSignal: AbortSignal) {
  const controller = new AbortController();
  const forward = () => {
    controller.abort(phaseSignal.reason);
  };
  if (phaseSignal.aborted) {
    controller.abort(phaseSignal.reason);
  } else {
    phaseSignal.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => phaseSignal.removeEventListener("abort", forward),
  };
}
