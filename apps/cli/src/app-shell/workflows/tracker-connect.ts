// =============================================================================
// tracker-connect.ts — one implementation of "link this tracker"
//
// Its own module because both callers need it and neither can own it: the
// shell runs it from `/sync`, and setup runs it after the wizard commits
// config. Leaving it in `shell-workflows` made those two files import each
// other, which oxlint's `import(no-cycle)` correctly refused.
// =============================================================================

import type { Container } from "@/container";

export type TrackerConnectOutcome =
  | { readonly status: "connected"; readonly alreadyConnected?: boolean }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "unavailable" };

export type TrackerConnectOptions = {
  readonly signal: AbortSignal;
  readonly onPrompt?: (message: string) => void;
};

/**
 * Link a tracker account, reporting whether it is connected when this settles.
 *
 * The setup toggle used to write `sync.anilist.enabled` and stop there, which
 * made it a control that looked like it linked an account and did not — the
 * house silent-no-op. Setup calls this once the wizard closes, so a browser
 * handoff that fails costs an account link rather than the whole wizard.
 *
 * The return value keeps `sync.<tracker>.enabled` honest: a standing "yes" in
 * config must mean a token exists behind it (#232).
 *
 * Idempotent by state, not by re-auth: an already-connected adapter short-
 * circuits instead of opening another browser round-trip. A `needs-reauth`
 * connection still falls through to `connect` — that is exactly the case where
 * a fresh handshake is wanted.
 */
export async function connectNamedTracker(
  container: Container,
  tracker: "anilist" | "tmdb",
  options: TrackerConnectOptions,
): Promise<TrackerConnectOutcome> {
  const adapter = container.syncService.adapters.find((candidate) => candidate.id === tracker);
  if (!adapter) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Sync service ${tracker} is not available.`,
    });
    return { status: "unavailable" };
  }
  if (adapter.getConnection().state === "connected") {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `${adapter.displayName} is already connected.`,
    });
    return { status: "connected", alreadyConnected: true };
  }
  if (options.signal.aborted) return { status: "cancelled" };

  let result: Awaited<ReturnType<typeof adapter.connect>>;
  try {
    result = await adapter.connect({
      signal: options.signal,
      onPrompt: (note) => {
        container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note });
        options.onPrompt?.(note);
      },
    });
  } catch (error) {
    if (options.signal.aborted) {
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: `${adapter.displayName} connection cancelled.`,
      });
      return { status: "cancelled" };
    }
    const message = error instanceof Error ? error.message : String(error);
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Failed: ${message}`,
    });
    return { status: "failed", error: message };
  }
  if (options.signal.aborted) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `${adapter.displayName} connection cancelled.`,
    });
    return { status: "cancelled" };
  }
  if (!result.ok) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: `Failed: ${result.error}`,
    });
    return { status: "failed", error: result.error };
  }
  const resumed = container.syncService.resumeAfterReauth(adapter.id);
  if (resumed > 0) container.syncService.deliverSoon();
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Connected to ${adapter.displayName}.`,
  });
  return { status: "connected" };
}
