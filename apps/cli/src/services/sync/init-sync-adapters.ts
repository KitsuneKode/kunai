import type { TrackerId } from "./types";

/**
 * Load every tracker's stored credentials without letting one failure stop
 * startup. The token store rejects a read fault instead of inventing an empty
 * snapshot (so no patch can write over credentials it could not read); tracker
 * sync is optional, so a rejected load leaves that tracker disconnected and the
 * stored data in place for repair, while local playback and the other tracker
 * carry on. `onUnavailable` receives the tracker id only: the underlying error
 * may quote file or vault contents and is never passed on.
 */
export async function initSyncAdapters(
  adapters: readonly { readonly id: TrackerId; init(): Promise<void> }[],
  onUnavailable: (id: TrackerId) => void,
): Promise<void> {
  await Promise.all(
    adapters.map(async (adapter) => {
      try {
        await adapter.init();
      } catch {
        onUnavailable(adapter.id);
      }
    }),
  );
}
