import type { OfflinePlaybackLaunch } from "@/app/offline/offline-playback-launch";

type LibraryPlaybackResolver = (launch: OfflinePlaybackLaunch | null) => void;

let pendingResolver: LibraryPlaybackResolver | null = null;

/** Wait for the active root-owned Library overlay to select a playable artifact. */
export function waitForRootLibraryPlaybackLaunch(): Promise<OfflinePlaybackLaunch | null> {
  pendingResolver?.(null);
  return new Promise((resolve) => {
    pendingResolver = resolve;
  });
}

/** Deliver directly to the workflow that opened Library; no launch is retained afterward. */
export function resolveRootLibraryPlaybackLaunch(launch: OfflinePlaybackLaunch): void {
  const resolve = pendingResolver;
  pendingResolver = null;
  resolve?.(launch);
}

/** Settle a Library workflow that closed without selecting playback. */
export function cancelRootLibraryPlaybackLaunch(): void {
  const resolve = pendingResolver;
  pendingResolver = null;
  resolve?.(null);
}
