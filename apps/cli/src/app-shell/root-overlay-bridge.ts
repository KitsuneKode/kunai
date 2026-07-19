import type { Container } from "@/container";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { OverlayState } from "@/domain/session/SessionState";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

export type RootOwnedOverlay = Extract<
  OverlayState,
  {
    type:
      | "help"
      | "about"
      | "diagnostics"
      | "downloads"
      | "notifications"
      | "provider_picker"
      | "history"
      | "queue"
      | "settings";
  }
>;

export type NotificationPlaybackIntent = {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
};

let pendingPlaybackIntent: NotificationPlaybackIntent | null = null;
let pendingDetailsItem: MediaItemIdentity | null = null;
const detailsListeners = new Set<() => void>();
const playbackListeners = new Set<() => void>();

export function subscribeNotificationDetails(listener: () => void): () => void {
  detailsListeners.add(listener);
  return () => {
    detailsListeners.delete(listener);
  };
}

export function getNotificationDetailsPending(): boolean {
  return pendingDetailsItem !== null;
}

/**
 * Notify on stage, exactly as the details intent does.
 *
 * Without this, consuming the intent depended on *how* the overlay was opened:
 * `openNotificationsOverlay` reads it on close, but the overlay is also opened
 * by a direct `OPEN_OVERLAY` dispatch (root-overlay-shell), and on that path
 * "play now" staged an intent that nobody ever read — so playback silently did
 * nothing, and the stale intent then fired against the *next* session.
 */
export function subscribeNotificationPlayback(listener: () => void): () => void {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

export function getNotificationPlaybackPending(): boolean {
  return pendingPlaybackIntent !== null;
}

export function stageNotificationPlaybackIntent(intent: NotificationPlaybackIntent): void {
  pendingPlaybackIntent = intent;
  for (const listener of playbackListeners) {
    listener();
  }
}

/**
 * Drop an intent that was staged but never consumed.
 *
 * Must be called when the inbox *opens*, never when it closes: the palette
 * route deliberately reads the intent after the overlay has closed, so clearing
 * on close would break the one path that works. Clearing on open bounds the
 * lifetime of a dropped hand-off to a single session, so a stale intent can no
 * longer fire against a later, unrelated one.
 */
export function clearNotificationPlaybackIntent(): void {
  pendingPlaybackIntent = null;
}

export function takeNotificationPlaybackIntent(): NotificationPlaybackIntent | null {
  const intent = pendingPlaybackIntent;
  pendingPlaybackIntent = null;
  return intent;
}

export function stageNotificationDetailsItem(item: MediaItemIdentity): void {
  pendingDetailsItem = item;
  for (const listener of detailsListeners) {
    listener();
  }
}

export function takeNotificationDetailsItem(): MediaItemIdentity | null {
  const item = pendingDetailsItem;
  pendingDetailsItem = null;
  return item;
}

export async function openRootOwnedOverlay(
  container: Container,
  overlay: RootOwnedOverlay,
): Promise<void> {
  const { stateManager } = container;

  // OPEN_OVERLAY pushes a different type and replaces only the same type
  // (see shouldReplaceOpenOverlay). Never REPLACE_TOP across types — that
  // erases Esc history (e.g. notifications → help cannot return to inbox).
  stateManager.dispatch({
    type: "OPEN_OVERLAY",
    overlay,
  });
  await new Promise<void>((resolve) => {
    const unsubscribe = stateManager.subscribe((state) => {
      const top = state.activeModals.at(-1);
      if (!top || top.type !== overlay.type) {
        unsubscribe();
        resolve();
      }
    });
  });
}

export type DiagnosticsOverlayPreparation = {
  readonly recordMemorySample: (container: Container, source: string) => void;
  readonly runYoutubeProbes: (container: Container) => Promise<void>;
};

async function loadDiagnosticsOverlayPreparation(): Promise<DiagnosticsOverlayPreparation> {
  const { recordDiagnosticsPanelMemorySample } = await import("./diagnostics-panel-source");
  const { runYoutubeDiagnosticsProbes } =
    await import("@/services/youtube/youtube-diagnostics-probes");
  return {
    recordMemorySample: recordDiagnosticsPanelMemorySample,
    runYoutubeProbes: async (container) => {
      // Probe results are recorded as normal diagnostic events; the overlay
      // reconstructs YouTube evidence via extractYoutubeProbeFromEvents.
      await runYoutubeDiagnosticsProbes(container);
    },
  };
}

export async function openDiagnosticsOverlay(
  container: Container,
  source: string,
  load: () => Promise<DiagnosticsOverlayPreparation> = loadDiagnosticsOverlayPreparation,
): Promise<void> {
  const preparation = await load();
  preparation.recordMemorySample(container, source);
  await preparation.runYoutubeProbes(container);
  await openRootOwnedOverlay(container, { type: "diagnostics" });
}

export async function openNotificationsOverlay(container: Container): Promise<{
  readonly playback: NotificationPlaybackIntent | null;
}> {
  // Unread state is cleared explicitly inside the surface (r / A), not on open —
  // so the unread dots stay visible and the manual keys do something. The bell
  // hides once countUnread hits zero.
  await openRootOwnedOverlay(container, { type: "notifications" });
  return {
    playback: takeNotificationPlaybackIntent(),
  };
}
