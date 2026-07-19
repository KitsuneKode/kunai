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

export function subscribeNotificationDetails(listener: () => void): () => void {
  detailsListeners.add(listener);
  return () => {
    detailsListeners.delete(listener);
  };
}

export function getNotificationDetailsPending(): boolean {
  return pendingDetailsItem !== null;
}

export function stageNotificationPlaybackIntent(intent: NotificationPlaybackIntent): void {
  pendingPlaybackIntent = intent;
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
