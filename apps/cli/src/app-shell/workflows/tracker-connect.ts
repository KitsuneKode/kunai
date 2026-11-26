// One implementation of "link this tracker"
//
// Its own module because both callers need it and neither can own it: the
// shell runs it from `/sync`, and setup runs it after the wizard commits
// config. Leaving it in `shell-workflows` made those two files import each
// other, which oxlint's `import(no-cycle)` correctly refused.

import type { Container } from "@/container";
import type { SyncAdapter } from "@/services/sync/SyncAdapter";
import type { SyncCapabilities } from "@/services/sync/types";

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
  // A fresh link is the user asking for sync: turn on what this tracker can
  // do. Connecting used to leave every flag at its default (off), so the
  // account showed "connected · up to date" while nothing was ever sent.
  await setTrackerSync(container, tracker, adapter.capabilities, true);
  const resumed = container.syncService.resumeAfterReauth(adapter.id);
  if (resumed > 0) container.syncService.deliverSoon();
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Connected to ${adapter.displayName}.`,
  });
  return { status: "connected" };
}

/**
 * Unlink a tracker and turn its sync off, so config never claims a link with
 * no token behind it (#232). Every disconnect path goes through here.
 */
export async function disconnectNamedTracker(
  container: Container,
  adapter: Pick<SyncAdapter, "id" | "displayName" | "capabilities" | "disconnect">,
  options: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  await adapter.disconnect({ signal: options.signal ?? new AbortController().signal });
  await setTrackerSync(container, adapter.id, adapter.capabilities, false);
  container.stateManager.dispatch({
    type: "SET_PLAYBACK_FEEDBACK",
    note: `Disconnected from ${adapter.displayName}.`,
  });
}

/**
 * Turn a linked tracker's sync on. Setup calls this for an account that was
 * already connected when the user ticked it: the tick is the request.
 */
export async function turnOnTrackerSync(
  container: Container,
  tracker: "anilist" | "tmdb",
): Promise<void> {
  const adapter = container.syncService.adapters.find((candidate) => candidate.id === tracker);
  if (adapter) await setTrackerSync(container, tracker, adapter.capabilities, true);
}

/**
 * The sync switches a link or unlink implies. On: sync itself, episode
 * progress where the tracker has it, and lists where it can hold them. Off:
 * the main switch only, so a later reconnect starts from the user's choices.
 * Read live, because a Settings session may have changed them since startup.
 */
async function setTrackerSync(
  container: Container,
  tracker: "anilist" | "tmdb",
  capabilities: SyncCapabilities,
  on: boolean,
): Promise<void> {
  const sync = container.config.getRaw().sync;
  const current = sync[tracker];
  const next = on
    ? {
        ...current,
        enabled: true,
        trackWatched: capabilities.episodeProgress || current.trackWatched,
        syncList:
          capabilities.watchlistMembership || capabilities.favoriteMembership || current.syncList,
      }
    : { ...current, enabled: false };
  await container.config.update({ sync: { ...sync, [tracker]: next } });
  await container.config.save();
}
